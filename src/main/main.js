import { app, BrowserWindow, dialog, ipcMain, shell, Notification } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './store.js';
import * as agent from './agent.js';
import * as obsidian from './obsidian.js';
import {
  tutorSystemPrompt,
  tutorTurnSuffix,
  firstTurnPrompt,
  explainGraderPrompt,
  cardGenPrompt,
  recallGraderPrompt,
  coachPrompt,
  countQuestions,
  NARROW_REQUEST,
  HINT_LADDER,
} from './prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win = null;

/**
 * userData 경로는 앱 이름에서 파생된다. 여기서 못 박아두면
 * package.json 의 name/productName 을 나중에 바꿔도 기존 데이터가 그대로 보인다.
 * app.getPath('userData') 를 처음 호출하기 전에 실행돼야 한다.
 */
app.setName('Learn with Claude');

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#14120f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  agent.setModel(store.getSettings().model);
  createWindow();
  scheduleDueNotification();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  store.flush();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => store.flush());
// 강제 종료·로그아웃 등으로 before-quit 을 못 받는 경우의 마지막 방어선
process.on('exit', () => {
  try {
    store.flush();
  } catch {
    /* 종료 중이라 무시 */
  }
});

/** 복습 연체 알림 — 앱 실행 중 1시간마다 체크 */
function scheduleDueNotification() {
  const check = () => {
    const n = store.dueCards().length;
    if (n >= 3 && Notification.isSupported()) {
      new Notification({
        title: '인출 복습 대기 중',
        body: `${n}장이 복습 예정이에요. 덮고 꺼내볼 시간이에요.`,
      }).show();
    }
  };
  setTimeout(check, 60_000);
  setInterval(check, 3_600_000);
}

/* ─────────────────────────── IPC ─────────────────────────── */

const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));
const send = (ch, payload) => win?.webContents.send(ch, payload);

handle('settings:get', () => store.getSettings());
handle('onboarding:complete', () => store.setSettings({ onboardingDone: true }));
handle('settings:set', (patch) => {
  const s = store.setSettings(patch);
  agent.setModel(s.model);
  return s;
});
handle('meta:ladder', () => HINT_LADDER);

/* ── 데이터 보관 ── */
handle('data:info', () => store.dataInfo());
handle('data:backup', () => {
  store.flush();
  const name = store.backupNow('manual');
  if (!name) throw new Error('백업을 만들지 못했어요.');
  return name;
});
handle('data:reveal', () => {
  store.flush();
  shell.showItemInFolder(store.dataInfo().file);
});
handle('health:check', () => agent.healthCheck());
handle('agent:abort', (requestId) => agent.abort(requestId));

/* ── 탐구 (레버 1 + 2) ── */

handle('session:list', () => store.listSessions());
handle('session:get', (sid) => store.getSession(sid));

handle('session:create', async ({ topic, question, hypothesis }) => {
  const h = (hypothesis || '').trim();
  if (h.length < 20) {
    throw new Error('가설이 너무 짧아요. 틀려도 좋으니 최소 20자 이상, 내 추측을 먼저 적어주세요. (레버 1: 먼저 나부터)');
  }
  return store.createSession({ topic, question, hypothesis: h });
});

handle('session:hint', (sid, level) => store.updateSession(sid, { hintLevel: Math.max(0, Math.min(3, level)) }));

handle('session:send', async ({ sessionId, text, requestId }) => {
  const s = store.getSession(sessionId);
  if (!s) throw new Error('세션을 찾을 수 없어요.');

  const isFirst = s.messages.length === 0;
  const body = isFirst
    ? firstTurnPrompt({ question: s.question, hypothesis: s.hypothesis })
    : text;

  if (!isFirst && !String(text || '').trim()) throw new Error('보낼 내용이 비어 있어요.');

  store.addMessage(sessionId, { role: 'user', text: isFirst ? `[가설] ${s.hypothesis}` : text });

  const prompt = body + tutorTurnSuffix(s.hintLevel);
  const settings = store.getSettings();

  const { text: reply, sessionId: sdkId } = await agent.run({
    prompt,
    systemPrompt: tutorSystemPrompt({ topic: s.topic, learnerLevel: settings.learnerLevel }),
    resume: s.sdkSessionId || undefined,
    requestId,
    onDelta: (d) => send('stream:delta', { requestId, delta: d }),
  });

  store.updateSession(sessionId, { sdkSessionId: sdkId });
  store.addMessage(sessionId, { role: 'assistant', text: reply, hintLevel: s.hintLevel });

  // "한 턴에 질문 하나" 규칙 위반 감지 (L3는 정답 공개라 예외)
  const questions = countQuestions(reply);
  const tooMany = s.hintLevel < 3 && questions > 1;
  store.logEvent('tutor_turn', { sessionId, hintLevel: s.hintLevel, questions, tooMany });

  return { text: reply, questions, tooMany, session: store.getSession(sessionId) };
});

handle('meta:narrowRequest', () => NARROW_REQUEST);

/* ── Obsidian ── */

/** 자기설명 하나를 노트 + 개념 허브로 내보낸다. */
function doExport(explainId) {
  const explain = store.getExplain(explainId);
  if (!explain) throw new Error('자기설명 기록을 찾을 수 없어요.');

  const s = store.getSettings();
  if (!s.obsidianVault) throw new Error('설정에서 Obsidian 보관함을 먼저 선택해 주세요.');

  const session = explain.sessionId ? store.getSession(explain.sessionId) : null;
  const cards = explain.sessionId ? store.cardsForSession(explain.sessionId) : [];

  const r = obsidian.exportExplain({
    vaultPath: s.obsidianVault,
    rootFolder: s.obsidianFolder,
    session,
    explain,
    cards,
    exportCards: s.obsidianCards,
    conceptStat: store.conceptStat,
  });

  store.logEvent('obsidian_export', {
    explainId,
    concepts: r.concepts.length,
    cards: r.cardCount,
  });
  return r;
}

handle('obsidian:check', () => {
  const s = store.getSettings();
  return { path: s.obsidianVault, ...obsidian.checkVault(s.obsidianVault) };
});

handle('obsidian:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Obsidian 보관함 선택',
    properties: ['openDirectory', 'createDirectory'],
    message: '노트를 저장할 Obsidian 보관함 폴더를 고르세요.',
  });
  if (r.canceled || !r.filePaths?.length) return null;
  const picked = r.filePaths[0];
  const check = obsidian.checkVault(picked);
  if (!check.ok) throw new Error(check.reason);
  store.setSettings({ obsidianVault: picked });
  return { path: picked, ...check };
});

handle('obsidian:export', (explainId) => doExport(explainId));

handle('obsidian:reveal', (file) => shell.showItemInFolder(file));

/* ── 설명 (레버 4) ── */

handle('explain:grade', async ({ sessionId, topic, explanation }) => {
  if ((explanation || '').trim().length < 60)
    throw new Error('설명이 너무 짧아요. 최소 60자 이상, 남에게 가르치듯 써주세요.');

  const context = sessionId ? store.transcript(sessionId, 12) : '';
  const json = await agent.runJson({
    prompt: explainGraderPrompt({ topic, explanation, context }),
  });

  const rec = store.addExplain({
    sessionId: sessionId || null,
    topic,
    text: explanation,
    score: Number(json.score) || 0,
    verdict: json.verdict || '',
    findings: Array.isArray(json.findings) ? json.findings : [],
    concepts: Array.isArray(json.concepts) ? json.concepts : [],
  });

  // 자동 내보내기가 켜져 있어도 진단 자체는 성공시킨다 — 내보내기 실패는 별도로 알린다.
  const s = store.getSettings();
  let exported = null;
  let exportError = null;
  if (s.obsidianAuto && s.obsidianVault) {
    try {
      exported = doExport(rec.id);
    } catch (err) {
      exportError = String(err?.message ?? err);
    }
  }
  return { ...rec, exported, exportError };
});

handle('explain:list', () => store.listExplains());

/* ── 인출 (레버 3) ── */

handle('cards:generate', async ({ sessionId, count }) => {
  const s = store.getSession(sessionId);
  if (!s) throw new Error('세션을 찾을 수 없어요.');
  if (s.messages.length < 2) throw new Error('대화가 너무 짧아요. 조금 더 씨름한 뒤에 카드를 만드세요.');

  const raw = await agent.runJson({
    prompt: cardGenPrompt({ topic: s.topic, transcript: store.transcript(sessionId), count: count || 5 }),
  });
  const arr = Array.isArray(raw) ? raw : raw?.cards;
  if (!Array.isArray(arr)) throw new Error('카드 형식이 올바르지 않아요.');
  return store.addCards(sessionId, s.topic, arr);
});

handle('cards:due', () => store.dueCards());
handle('cards:all', () => store.listCards());
handle('cards:delete', (id) => store.deleteCard(id));

handle('cards:answer', async ({ cardId, answer }) => {
  const card = store.listCards().find((c) => c.id === cardId);
  if (!card) throw new Error('카드를 찾을 수 없어요.');

  const json = await agent.runJson({
    prompt: recallGraderPrompt({ front: card.front, back: card.back, answer: answer || '(백지)' }),
  });
  const grade = Math.max(0, Math.min(5, Number(json.grade) || 0));
  const updated = store.gradeCard(cardId, grade);
  return { grade, feedback: json.feedback || '', missing: json.missing || [], card: updated };
});

/* ── 대시보드 ── */

handle('stats:get', () => ({ stats: store.stats(), antipatterns: store.antipatterns() }));

handle('stats:coach', async () => {
  const s = store.stats();
  const { text } = await agent.run({
    prompt: coachPrompt({ stats: { ...s, daily: undefined } }),
    systemPrompt: '당신은 학습과학에 밝은 코치예요. 한국어 해요체로 짧게 답해요.',
  });
  return text;
});
