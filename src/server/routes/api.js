import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import * as obsidian from '../../main/obsidian.js';
import {
  tutorSystemPrompt,
  tutorTurnSuffix,
  firstTurnPrompt,
  explainGraderPrompt,
  cardGenPrompt,
  recallGraderPrompt,
  recallQuestionPrompt,
  coachPrompt,
  conceptDagPrompt,
  conceptNotePrompt,
  countQuestions,
  NARROW_REQUEST,
  HINT_LADDER,
} from '../../main/prompts.js';

/** 자기설명을 Obsidian 노트로 내보내는 공통 헬퍼 */
function doExport(store, explainId) {
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
  store.logEvent('obsidian_export', { explainId, concepts: r.concepts.length, cards: r.cardCount });
  return r;
}

/** 개념 파일에 선수 개념 링크 추가 */
function appendDagLink(file, fromConcept, conceptsDir) {
  const existing = fs.readFileSync(file, 'utf8');
  const link = `- [[${conceptsDir}/${obsidian.safeName(fromConcept)}|${fromConcept}]]`;
  if (existing.includes(link)) return;
  const marker = '## 선수 개념';
  if (existing.includes(marker)) {
    const idx = existing.indexOf(marker) + marker.length;
    fs.writeFileSync(file, existing.slice(0, idx) + '\n\n' + link + existing.slice(idx));
  } else {
    fs.appendFileSync(file, `\n\n${marker}\n\n${link}\n`);
  }
}

export function createRouter({ store, agent }) {
  const r = Router();

  /* ── 공통 에러 래퍼 ── */
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ error: String(e.message ?? e) });
    }
  };

  /* ── 설정 ── */
  r.get('/settings', wrap((req, res) => res.json(store.getSettings())));

  r.patch('/settings', wrap((req, res) => {
    const s = store.setSettings(req.body);
    agent.setModel(s.model);
    res.json(s);
  }));

  r.post('/onboarding/complete', wrap((req, res) => {
    store.setSettings({ onboardingDone: true });
    res.json({ ok: true });
  }));

  /* ── 헬스 / 메타 ── */
  r.get('/health', wrap(async (req, res) => res.json(await agent.healthCheck())));

  r.get('/meta/ladder', wrap((req, res) => res.json(HINT_LADDER)));
  r.get('/meta/narrow-request', wrap((req, res) => res.json(NARROW_REQUEST)));

  r.get('/claude/version', (req, res) => {
    exec('claude --version', (err, stdout) => {
      res.json({ version: err ? '확인 불가' : stdout.trim() });
    });
  });

  r.post('/usage/reset', wrap((req, res) =>
    res.json(store.setSettings({ totalUsage: { input: 0, output: 0 } }))));

  /* ── 데이터 ── */
  r.get('/data/info', wrap((req, res) => res.json(store.dataInfo())));

  r.post('/data/backup', wrap((req, res) => {
    store.flush();
    const name = store.backupNow('manual');
    if (!name) { const e = new Error('백업을 만들지 못했어요.'); e.status = 500; throw e; }
    res.json({ name });
  }));

  r.post('/data/reveal', wrap((req, res) => {
    store.flush();
    exec(`open -R "${store.dataInfo().file}"`);
    res.json({ ok: true });
  }));

  /* ── 에이전트 중단 ── */
  r.post('/agent/abort', wrap((req, res) =>
    res.json({ aborted: agent.abort(req.body.requestId) })));

  /* ── 세션 ── */
  r.get('/sessions', wrap((req, res) => res.json(store.listSessions())));

  r.get('/sessions/:id', wrap((req, res) => {
    const s = store.getSession(req.params.id);
    if (!s) { const e = new Error('세션을 찾을 수 없어요.'); e.status = 404; throw e; }
    res.json(s);
  }));

  r.post('/sessions', wrap((req, res) => {
    const { topic, question, hypothesis } = req.body;
    const h = (hypothesis || '').trim();
    if (h.length < 20) {
      const e = new Error('가설이 너무 짧아요. 틀려도 좋으니 최소 20자 이상, 내 추측을 먼저 적어주세요.');
      e.status = 400; throw e;
    }
    res.json(store.createSession({ topic, question, hypothesis: h }));
  }));

  r.patch('/sessions/:id/hint', wrap((req, res) => {
    const { level } = req.body;
    res.json(store.updateSession(req.params.id, { hintLevel: Math.max(0, Math.min(3, Number(level))) }));
  }));

  /* ── 세션 메시지 (SSE 스트리밍) ── */
  r.post('/sessions/:id/messages', async (req, res) => {
    const { text, requestId } = req.body;
    const s = store.getSession(req.params.id);
    if (!s) return res.status(404).json({ error: '세션을 찾을 수 없어요.' });

    const isFirst = s.messages.length === 0;
    const body = isFirst
      ? firstTurnPrompt({ question: s.question, hypothesis: s.hypothesis })
      : text;
    if (!isFirst && !String(text || '').trim())
      return res.status(400).json({ error: '보낼 내용이 비어 있어요.' });

    store.addMessage(s.id, { role: 'user', text: isFirst ? `[가설] ${s.hypothesis}` : text });

    const prompt = body + tutorTurnSuffix(s.hintLevel);
    const settings = store.getSettings();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

    req.on('close', () => { if (requestId) agent.abort(requestId); });

    try {
      const { text: reply, sessionId: sdkId, usage } = await agent.run({
        prompt,
        systemPrompt: tutorSystemPrompt({ topic: s.topic, learnerLevel: settings.learnerLevel }),
        resume: s.sdkSessionId || undefined,
        requestId,
        onDelta: (d) => send('delta', { delta: d }),
      });

      if (usage.input || usage.output) {
        const cur = store.getSettings().totalUsage ?? { input: 0, output: 0 };
        store.setSettings({ totalUsage: { input: cur.input + usage.input, output: cur.output + usage.output } });
      }
      store.updateSession(s.id, { sdkSessionId: sdkId });
      store.addMessage(s.id, { role: 'assistant', text: reply, hintLevel: s.hintLevel });

      const questions = countQuestions(reply);
      const tooMany = s.hintLevel < 3 && questions > 1;
      store.logEvent('tutor_turn', { sessionId: s.id, hintLevel: s.hintLevel, questions, tooMany });

      send('done', { text: reply, questions, tooMany, session: store.getSession(s.id) });
    } catch (e) {
      send('error', { error: String(e.message ?? e) });
    } finally {
      res.end();
    }
  });

  /* ── Obsidian ── */
  r.get('/obsidian/check', wrap((req, res) => {
    const s = store.getSettings();
    res.json({ path: s.obsidianVault, ...obsidian.checkVault(s.obsidianVault) });
  }));

  // 웹앱: 네이티브 다이얼로그 대신 경로를 body로 받음
  r.post('/obsidian/pick', wrap((req, res) => {
    const { vaultPath } = req.body;
    if (!vaultPath) { const e = new Error('보관함 경로를 입력해주세요.'); e.status = 400; throw e; }
    const check = obsidian.checkVault(vaultPath);
    if (!check.ok) { const e = new Error(check.reason); e.status = 400; throw e; }
    store.setSettings({ obsidianVault: vaultPath });
    res.json({ path: vaultPath, ...check });
  }));

  r.post('/obsidian/export', wrap((req, res) => res.json(doExport(store, req.body.explainId))));

  r.post('/obsidian/reveal', wrap((req, res) => {
    exec(`open -R "${req.body.file}"`);
    res.json({ ok: true });
  }));

  r.post('/obsidian/build-dag', wrap(async (req, res) => {
    const s = store.getSettings();
    if (!s.obsidianVault) { const e = new Error('Obsidian 보관함을 먼저 설정해주세요.'); e.status = 400; throw e; }

    const concepts = [...new Set(store.listExplains().flatMap((e) => e.concepts ?? []).filter(Boolean))];
    if (concepts.length < 2) { const e = new Error('개념이 2개 이상 있어야 그래프를 만들 수 있어요.'); e.status = 400; throw e; }

    const result = await agent.runJson({ prompt: conceptDagPrompt({ concepts }) });
    const edges = Array.isArray(result?.edges) ? result.edges : [];

    if (edges.length) {
      const root = path.join(s.obsidianVault, obsidian.safeName(s.obsidianFolder || 'Learn with Claude'));
      const CDIR = '개념';
      for (const edge of edges) {
        const toFile = path.join(root, CDIR, `${obsidian.safeName(edge.to)}.md`);
        if (fs.existsSync(toFile)) appendDagLink(toFile, edge.from, CDIR);
        if (edge.bidirectional) {
          const fromFile = path.join(root, CDIR, `${obsidian.safeName(edge.from)}.md`);
          if (fs.existsSync(fromFile)) appendDagLink(fromFile, edge.to, CDIR);
        }
      }
    }
    store.logEvent('obsidian_dag', { concepts: concepts.length, edges: edges.length });
    res.json({ edges: edges.length });
  }));

  r.post('/obsidian/concept-note', wrap(async (req, res) => {
    const { concept, sessionIds, language } = req.body;
    const s = store.getSettings();
    if (!s.obsidianVault) { const e = new Error('Obsidian 보관함이 설정되지 않았어요.'); e.status = 400; throw e; }

    const allSessions = store.listSessions();
    const sessions = (sessionIds || [])
      .map((id) => allSessions.find((sess) => sess.id === id))
      .filter(Boolean)
      .map((sess) => ({ createdAt: sess.createdAt, hypothesis: sess.hypothesis, explainScore: null }));

    const { text: noteContent } = await agent.run({
      prompt: conceptNotePrompt({ concept, sessions, language: language || 'JavaScript' }),
    });
    const filePath = obsidian.writeConceptNote(s.obsidianVault, s.obsidianFolder, concept, noteContent);
    res.json({ filePath });
  }));

  /* ── 자기설명 ── */
  r.post('/explains/grade', wrap(async (req, res) => {
    const { sessionId, topic, explanation } = req.body;
    if ((explanation || '').trim().length < 60) {
      const e = new Error('설명이 너무 짧아요. 최소 60자 이상, 남에게 가르치듯 써주세요.');
      e.status = 400; throw e;
    }

    const context = sessionId ? store.transcript(sessionId, 12) : '';
    const json = await agent.runJson({ prompt: explainGraderPrompt({ topic, explanation, context }) });

    const rec = store.addExplain({
      sessionId: sessionId || null,
      topic,
      text: explanation,
      score: Number(json.score) || 0,
      verdict: json.verdict || '',
      findings: Array.isArray(json.findings) ? json.findings : [],
      concepts: Array.isArray(json.concepts) ? json.concepts : [],
    });

    if (sessionId && Number(json.score) >= 70) {
      const mult = Number(json.score) >= 90 ? 3.5 : Number(json.score) >= 80 ? 2.5 : 1.8;
      store.updateForgettingData(sessionId, mult);
    }

    const settings = store.getSettings();
    let exported = null, exportError = null;
    if (settings.obsidianAuto && settings.obsidianVault) {
      try { exported = doExport(store, rec.id); }
      catch (e) { exportError = String(e.message ?? e); }
    }
    res.json({ ...rec, exported, exportError });
  }));

  r.get('/explains', wrap((req, res) => res.json(store.listExplains())));

  /* ── 인출 카드 ── */
  r.post('/cards/generate', wrap(async (req, res) => {
    const { sessionId, count } = req.body;
    const s = store.getSession(sessionId);
    if (!s) { const e = new Error('세션을 찾을 수 없어요.'); e.status = 404; throw e; }
    if (s.messages.length < 2) { const e = new Error('대화가 너무 짧아요. 조금 더 씨름한 뒤에 카드를 만드세요.'); e.status = 400; throw e; }

    const raw = await agent.runJson({
      prompt: cardGenPrompt({ topic: s.topic, transcript: store.transcript(sessionId), count: count || 5 }),
    });
    const arr = Array.isArray(raw) ? raw : raw?.cards;
    if (!Array.isArray(arr)) { const e = new Error('카드 형식이 올바르지 않아요.'); e.status = 500; throw e; }
    res.json(store.addCards(sessionId, s.topic, arr));
  }));

  r.get('/cards/due', wrap((req, res) => res.json(store.dueCards())));
  r.get('/cards', wrap((req, res) => res.json(store.listCards())));

  r.delete('/cards/:id', wrap((req, res) => {
    store.deleteCard(req.params.id);
    res.json({ ok: true });
  }));

  r.post('/cards/:id/answer', wrap(async (req, res) => {
    const { answer } = req.body;
    const card = store.listCards().find((c) => c.id === req.params.id);
    if (!card) { const e = new Error('카드를 찾을 수 없어요.'); e.status = 404; throw e; }

    const json = await agent.runJson({
      prompt: recallGraderPrompt({ front: card.front, back: card.back, answer: answer || '(백지)' }),
    });
    const grade = Math.max(0, Math.min(5, Number(json.grade) || 0));
    const updated = store.gradeCard(req.params.id, grade);
    res.json({ grade, feedback: json.feedback || '', missing: json.missing || [], card: updated });
  }));

  /* ── 대시보드 ── */
  r.get('/forgetting/status', wrap((req, res) => {
    res.json(store.listSessions().map((s) => ({
      id: s.id,
      topic: s.topic,
      retention: store.calcRetention(s.id),
      dueForRecall: !!s.forgettingData &&
        Math.exp(-(Date.now() - s.forgettingData.lastReview) / (86400000 * s.forgettingData.stability)) < 0.8,
    })));
  }));

  r.get('/stats', wrap((req, res) => res.json({ stats: store.stats(), antipatterns: store.antipatterns() })));

  r.get('/stats/coach', wrap(async (req, res) => {
    const s = store.stats();
    const { text } = await agent.run({
      prompt: coachPrompt({ stats: { ...s, daily: undefined } }),
      systemPrompt: '당신은 학습과학에 밝은 코치예요. 한국어 해요체로 짧게 답해요.',
    });
    res.json({ text });
  }));

  /* ── 알림 폴링 (Electron Notification 대체) ── */
  r.get('/notifications/due', wrap(async (req, res) => {
    const dueCards = store.dueCards().length;
    const dueSessions = store.sessionsDueForRecall();
    let recallQuestion = null;
    if (dueSessions.length > 0) {
      try {
        const s = dueSessions[0];
        const json = await agent.runJson({
          prompt: recallQuestionPrompt({ topic: s.topic, hypothesis: s.hypothesis, transcript: store.transcript(s.id, 6) }),
        });
        recallQuestion = { topic: s.topic, question: json.question || '이 주제를 다시 떠올려보세요.' };
      } catch { /* best-effort */ }
    }
    res.json({ dueCards, recallQuestion });
  }));

  return r;
}
