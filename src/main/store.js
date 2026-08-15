/**
 * 로컬 JSON 저장소 + SRS 스케줄러 + 안티패턴 감지.
 *
 * 저장 위치: ~/Library/Application Support/Learn with Claude/
 *   data.json            현재 데이터
 *   backups/*.json       자동 백업 (하루 1개 + 스키마 변경 직전)
 *
 * 이 디렉터리는 앱 번들 바깥이라 재설치·업데이트로 지워지지 않는다.
 * 경로는 app.setName() 으로 고정돼 있어 productName 을 바꿔도 이동하지 않는다.
 *
 * 내구성 설계:
 *  - 쓰기는 원자적 (tmp 파일 → rename). 쓰는 도중 죽어도 기존 파일이 온전히 남는다.
 *  - data.json 이 깨지면 가장 최근 백업으로 자동 복구하고, 깨진 파일은 보존한다.
 *  - 스키마 버전이 오르면 마이그레이션 전에 먼저 백업한다.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 스키마를 바꿀 때 올리고 MIGRATIONS 에 함수를 추가한다. */
export const SCHEMA_VERSION = 1;
const KEEP_BACKUPS = 10;

let DIR = null;
let FILE = null;
let BACKUP_DIR = null;
let db = null;
const notes = []; // 부팅 중 일어난 복구/마이그레이션 기록

const EMPTY = {
  version: SCHEMA_VERSION,
  settings: {
    learnerLevel: '개발자, 이 도메인은 초심자',
    model: 'sonnet',
    obsidianVault: '', // 빈 값이면 내보내기 비활성
    obsidianFolder: 'Learn with Claude',
    obsidianAuto: false, // 자기설명 진단 직후 자동 내보내기
    obsidianCards: true, // 인출 카드도 함께 (spaced-repetition 포맷)
    onboardingDone: false, // 첫 실행 온보딩 완료 여부
    totalUsage: { input: 0, output: 0 }, // 누적 토큰 사용량
  },
  sessions: [], // { id, topic, question, hypothesis, sdkSessionId, hintLevel, maxHintLevel, messages[], createdAt, closedAt }
  cards: [], // { id, sessionId, front, back, concept, kind, ease, interval, due, reps, lapses, history[] }
  explains: [], // { id, sessionId, topic, text, score, findings[], concepts[], createdAt }
  events: [], // { t, type, ...payload }
};

/**
 * 버전 n 으로 올리는 변환. 기존 데이터를 절대 버리지 말고 채워 넣기만 할 것.
 * 예) 2: (d) => { for (const c of d.cards) c.suspended ??= false; }
 */
const MIGRATIONS = {};

/* ─────────────────────────── 부팅 ─────────────────────────── */

export function init(userDataDir) {
  DIR = userDataDir;
  FILE = path.join(userDataDir, 'data.json');
  BACKUP_DIR = path.join(userDataDir, 'backups');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  db = load();
  migrate();
  dailyBackup();
  writeNow();
  return db;
}

function parseFile(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('최상위가 객체가 아님');
  return parsed;
}

function load() {
  const fill = (d) => {
    for (const k of Object.keys(EMPTY)) if (d[k] === undefined) d[k] = structuredClone(EMPTY[k]);
    // 새 버전에서 추가된 설정 키를 기존 파일에 채워 넣는다 (업데이트 후 첫 실행)
    for (const [k, v] of Object.entries(EMPTY.settings)) if (d.settings[k] === undefined) d.settings[k] = v;
    return d;
  };

  if (fs.existsSync(FILE)) {
    try {
      return fill(parseFile(FILE));
    } catch (err) {
      // 깨진 파일은 지우지 말고 옆으로 치워둔다 — 수동 복구 여지를 남긴다.
      const quarantine = `${FILE}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(FILE, quarantine);
      } catch {
        /* 무시 */
      }
      notes.push(`data.json 이 손상돼 ${path.basename(quarantine)} 으로 격리했어요 (${err.message}).`);

      for (const b of backupList()) {
        try {
          const recovered = fill(parseFile(b.path));
          notes.push(`백업 ${b.name} 에서 복구했어요.`);
          return recovered;
        } catch {
          /* 다음 백업 시도 */
        }
      }
      notes.push('복구 가능한 백업이 없어 빈 데이터로 시작해요.');
    }
  }
  return structuredClone(EMPTY);
}

function migrate() {
  const from = Number(db.version) || 0;
  if (from === SCHEMA_VERSION) return;

  if (from > SCHEMA_VERSION) {
    // 더 새 버전이 쓴 파일. 알 수 없는 필드를 지우지 않도록 그대로 두고 백업만 남긴다.
    backupNow(`downgrade-from-v${from}`);
    notes.push(`더 새로운 형식(v${from})의 데이터예요. 손대지 않고 백업만 만들었어요.`);
    return;
  }

  backupNow(`pre-v${SCHEMA_VERSION}`);
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) MIGRATIONS[v]?.(db);
  db.version = SCHEMA_VERSION;
  if (from > 0) notes.push(`데이터 형식을 v${from} → v${SCHEMA_VERSION} 로 올렸어요.`);
}

/* ─────────────────────────── 쓰기 ─────────────────────────── */

let saveTimer = null;

/** tmp 에 쓴 뒤 rename — 같은 파일시스템에서 원자적이라 반쯤 쓰인 파일이 남지 않는다. */
function writeNow() {
  if (!FILE || !db) return;
  const tmp = `${FILE}.tmp`;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 120);
}

export function flush() {
  clearTimeout(saveTimer);
  writeNow();
}

/* ─────────────────────────── 백업 ─────────────────────────── */

function backupList() {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('data-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .map((name) => ({ name, path: path.join(BACKUP_DIR, name) }));
  } catch {
    return [];
  }
}

/** 현재 데이터를 백업 파일로 떠둔다. 반환: 파일명 (실패 시 null) */
export function backupNow(tag = 'manual') {
  if (!db || !BACKUP_DIR) return null;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `data-${stamp}-${tag}.json`;
    const tmp = path.join(BACKUP_DIR, `.${name}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, path.join(BACKUP_DIR, name));
    prune();
    return name;
  } catch {
    return null;
  }
}

/** 하루에 한 번, 그날 첫 실행 때만 스냅샷. */
function dailyBackup() {
  const today = new Date().toISOString().slice(0, 10);
  if (backupList().some((b) => b.name.startsWith(`data-${today}`))) return;
  // 완전히 빈 상태를 백업해 과거 백업을 밀어내지 않도록
  if (db.sessions.length === 0 && db.cards.length === 0) return;
  backupNow('daily');
}

function prune() {
  for (const b of backupList().slice(KEEP_BACKUPS)) {
    try {
      fs.unlinkSync(b.path);
    } catch {
      /* 무시 */
    }
  }
}

/** 설정 화면에 보여줄 저장소 상태. */
export function dataInfo() {
  let bytes = 0;
  try {
    bytes = fs.statSync(FILE).size;
  } catch {
    /* 아직 파일 없음 */
  }
  return {
    dir: DIR,
    file: FILE,
    bytes,
    version: db?.version ?? null,
    schemaVersion: SCHEMA_VERSION,
    backups: backupList().map((b) => b.name),
    notes: [...notes],
    counts: {
      sessions: db?.sessions.length ?? 0,
      cards: db?.cards.length ?? 0,
      explains: db?.explains.length ?? 0,
    },
  };
}

const id = () => crypto.randomUUID();
const now = () => Date.now();
const DAY = 86400000;
export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function logEvent(type, payload = {}) {
  db.events.push({ t: now(), type, ...payload });
  if (db.events.length > 5000) db.events.splice(0, db.events.length - 5000);
  save();
}

/* ─────────────────────────── settings ─────────────────────────── */

export const getSettings = () => db.settings;
export function setSettings(patch) {
  Object.assign(db.settings, patch);
  save();
  return db.settings;
}

/* ─────────────────────────── sessions ─────────────────────────── */

export function createSession({ topic, question, hypothesis }) {
  const s = {
    id: id(),
    topic: topic || question.slice(0, 40),
    question,
    hypothesis,
    sdkSessionId: null,
    hintLevel: 0,
    maxHintLevel: 0,
    messages: [],
    createdAt: now(),
    closedAt: null,
  };
  db.sessions.unshift(s);
  logEvent('session_start', {
    sessionId: s.id,
    topic: s.topic,
    hypothesisLen: (hypothesis || '').trim().length,
  });
  save();
  return s;
}

export const listSessions = () => db.sessions;
export const getSession = (sid) => db.sessions.find((s) => s.id === sid) ?? null;

export function updateSession(sid, patch) {
  const s = getSession(sid);
  if (!s) return null;
  Object.assign(s, patch);
  if (patch.hintLevel !== undefined) s.maxHintLevel = Math.max(s.maxHintLevel, patch.hintLevel);
  save();
  return s;
}

export function addMessage(sid, msg) {
  const s = getSession(sid);
  if (!s) return null;
  s.messages.push({ ...msg, t: now() });
  save();
  return s;
}

export function transcript(sid, limit = 40) {
  const s = getSession(sid);
  if (!s) return '';
  const head = `[주제] ${s.topic}\n[내 최초 가설] ${s.hypothesis}\n`;
  const body = s.messages
    .slice(-limit)
    .map((m) => `${m.role === 'user' ? '학습자' : '튜터'}: ${m.text}`)
    .join('\n\n');
  return head + '\n' + body;
}

/* ─────────────────────────── explains ─────────────────────────── */

export function addExplain(rec) {
  const e = { id: id(), createdAt: now(), ...rec };
  db.explains.unshift(e);
  logEvent('explain_graded', { sessionId: rec.sessionId, score: rec.score, topic: rec.topic });
  save();
  return e;
}
export const listExplains = () => db.explains;
export const getExplain = (eid) => db.explains.find((e) => e.id === eid) ?? null;

/* ─────────────────────────── cards + SRS ─────────────────────────── */

/** SM-2 축약판. grade 0~5, 3 미만이면 실패로 보고 다시 처음부터. */
export function schedule(card, grade) {
  if (grade < 3) {
    card.lapses = (card.lapses || 0) + 1;
    card.reps = 0;
    card.interval = 0; // 오늘 다시
    card.ease = Math.max(1.3, (card.ease ?? 2.5) - 0.2);
    card.due = now() + 10 * 60 * 1000; // 10분 뒤 재등장
  } else {
    card.reps = (card.reps || 0) + 1;
    card.ease = Math.max(
      1.3,
      (card.ease ?? 2.5) + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)),
    );
    if (card.reps === 1) card.interval = 1;
    else if (card.reps === 2) card.interval = 3;
    else card.interval = Math.round((card.interval || 3) * card.ease);
    card.interval = Math.min(card.interval, 365);
    card.due = startOfToday() + card.interval * DAY + 6 * 3600000; // 해당일 오전 6시
  }
  card.history = card.history || [];
  card.history.push({ t: now(), grade });
  return card;
}

export function addCards(sessionId, topic, raw) {
  const made = [];
  for (const c of raw) {
    if (!c?.front || !c?.back) continue;
    const card = {
      id: id(),
      sessionId,
      topic,
      front: String(c.front),
      back: String(c.back),
      concept: String(c.concept ?? topic),
      kind: c.kind ?? 'core',
      ease: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      due: now(), // 즉시 첫 인출
      history: [],
      createdAt: now(),
    };
    db.cards.push(card);
    made.push(card);
  }
  logEvent('cards_created', { sessionId, count: made.length, topic });
  save();
  return made;
}

export const listCards = () => db.cards;
export const cardsForSession = (sid) => db.cards.filter((c) => c.sessionId === sid);

/** 개념 하나의 인출 성적. Obsidian 허브 노트에 박아 넣는다. */
export function conceptStat(concept) {
  const g = db.events.filter((e) => e.type === 'card_graded' && e.concept === concept);
  if (!g.length) return null;
  return { total: g.length, ok: g.filter((e) => e.grade >= 3).length };
}
export const dueCards = () => db.cards.filter((c) => c.due <= now()).sort((a, b) => a.due - b.due);

export function gradeCard(cardId, grade) {
  const c = db.cards.find((x) => x.id === cardId);
  if (!c) return null;
  schedule(c, grade);
  logEvent('card_graded', { cardId, grade, concept: c.concept });
  save();
  return c;
}

export function deleteCard(cardId) {
  const i = db.cards.findIndex((x) => x.id === cardId);
  if (i >= 0) db.cards.splice(i, 1);
  save();
}

/* ─────────────────────────── dashboard ─────────────────────────── */

function pct(a, b) {
  return b === 0 ? null : Math.round((a / b) * 100);
}

export function stats() {
  const sessions = db.sessions;
  const cards = db.cards;
  const grades = db.events.filter((e) => e.type === 'card_graded');
  const recallOk = grades.filter((e) => e.grade >= 3).length;

  // 개념별 인출 성공률
  const byConcept = {};
  for (const e of grades) {
    const k = e.concept || '기타';
    byConcept[k] = byConcept[k] || { total: 0, ok: 0 };
    byConcept[k].total++;
    if (e.grade >= 3) byConcept[k].ok++;
  }
  const concepts = Object.entries(byConcept)
    .map(([concept, v]) => ({ concept, ...v, rate: pct(v.ok, v.total) }))
    .sort((a, b) => a.rate - b.rate);

  // 최근 14일 활동
  const since = startOfToday() - 13 * DAY;
  const daily = {};
  for (let i = 0; i < 14; i++) daily[new Date(since + i * DAY).toISOString().slice(0, 10)] = 0;
  for (const e of db.events) {
    if (e.t < since) continue;
    if (e.type !== 'card_graded' && e.type !== 'session_start' && e.type !== 'explain_graded') continue;
    const k = new Date(e.t).toISOString().slice(0, 10);
    if (k in daily) daily[k]++;
  }

  const explainAvg = db.explains.length
    ? Math.round(db.explains.reduce((a, e) => a + (e.score || 0), 0) / db.explains.length)
    : null;

  return {
    sessions: sessions.length,
    cards: cards.length,
    due: dueCards().length,
    overdue: cards.filter((c) => c.due < startOfToday()).length,
    recallRate: pct(recallOk, grades.length),
    recallTotal: grades.length,
    explainAvg,
    explainCount: db.explains.length,
    l3Rate: pct(sessions.filter((s) => s.maxHintLevel >= 3).length, sessions.length),
    avgHypothesisLen: sessions.length
      ? Math.round(sessions.reduce((a, s) => a + (s.hypothesis || '').trim().length, 0) / sessions.length)
      : 0,
    concepts,
    daily,
  };
}

/** 안티패턴 규칙 — 모델 호출 없이 로컬에서 즉시 판정. */
export function antipatterns() {
  const s = stats();
  const out = [];

  if (s.l3Rate !== null && s.sessions >= 3 && s.l3Rate >= 50)
    out.push({
      level: 'warn',
      title: '정답을 너무 빨리 열고 있어요',
      body: `세션의 ${s.l3Rate}%에서 정답 공개(L3)까지 갔어요. 생산적 고투가 제거되면 자기설명이 사라지고 유창한 출력을 수동 수용하게 돼요. 다음 세션은 L2에서 한 번 멈춰보세요.`,
    });

  if (s.sessions >= 3 && s.avgHypothesisLen < 40)
    out.push({
      level: 'warn',
      title: '가설이 형식적으로 짧아요',
      body: `평균 가설 길이가 ${s.avgHypothesisLen}자예요. 게이트를 통과하려고 대충 적으면 인출 시도가 없는 셈이라 뒤따르는 피드백이 기억에 붙지 않아요.`,
    });

  if (s.explainAvg !== null && s.recallRate !== null && s.recallTotal >= 5 && s.explainAvg - s.recallRate >= 25)
    out.push({
      level: 'danger',
      title: '유능감의 착각 신호',
      body: `자기설명 점수는 평균 ${s.explainAvg}점인데 인출 성공률은 ${s.recallRate}%예요. 보면서 설명할 땐 되는데 덮고 꺼낼 땐 안 나오는 상태예요.`,
    });

  if (s.overdue >= 5)
    out.push({
      level: 'warn',
      title: `복습 연체 ${s.overdue}장`,
      body: '카드를 만들고 인출하지 않으면 루프가 닫히지 않아요. 오늘 5장만 처리해보세요.',
    });

  // 같은 개념 재질문 감지
  const topics = {};
  for (const sess of db.sessions) {
    const k = (sess.topic || '').trim().toLowerCase();
    if (!k) continue;
    topics[k] = (topics[k] || 0) + 1;
  }
  const repeats = Object.entries(topics).filter(([, n]) => n >= 2);
  if (repeats.length)
    out.push({
      level: 'info',
      title: '같은 개념을 다시 묻고 있어요',
      body: `${repeats.map(([t, n]) => `"${t}" ×${n}`).join(', ')} — 인출 실패 신호예요. 이 개념은 카드로 만들어 간격 반복에 넣으세요.`,
    });

  const weak = s.concepts.filter((c) => c.total >= 2 && c.rate < 60);
  if (weak.length)
    out.push({
      level: 'info',
      title: '약한 개념',
      body: weak.map((c) => `${c.concept} (${c.rate}%)`).join(', '),
    });

  if (!out.length && s.sessions > 0)
    out.push({ level: 'ok', title: '지금 패턴 좋아요', body: '가설 → 힌트 절제 → 인출 루프가 유지되고 있어요.' });

  return out;
}
