const $ = (s) => document.querySelector(s);

function renderMarkdown(text) {
  const div = document.createElement('div');

  // 코드 블록을 placeholder로 분리 후 나머지 텍스트만 이스케이프
  const blocks = [];
  const stripped = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    if (lang) codeEl.dataset.lang = lang;
    codeEl.textContent = code.trimEnd();
    pre.append(codeEl);
    const ph = `\x00BLOCK${blocks.length}\x00`;
    blocks.push(pre.outerHTML);
    return ph;
  });

  // 코드 블록 외부 텍스트 이스케이프
  const escaped = stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 인라인 백틱: `code`
  const inlined = escaped.replace(/`([^`\n]+)`/g, (_, code) => {
    const c = document.createElement('code');
    c.className = 'inline-code';
    c.textContent = code;
    return c.outerHTML;
  });

  // placeholder 복원
  const final = blocks.reduce((s, html, i) => s.replace(`\x00BLOCK${i}\x00`, html), inlined);

  div.innerHTML = final;
  return div;
}
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const uuid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** 메인 프로세스가 응답하지 않을 때 쓰는 최소 기본값. */
const FALLBACK_LADDER = [
  { level: 0, name: '되묻기', badge: 'L0', directive: '' },
  { level: 1, name: '방향만', badge: 'L1', directive: '' },
  { level: 2, name: '예시 보기', badge: 'L2', directive: '' },
  { level: 3, name: '정답 보기', badge: 'L3', directive: '' },
];
const FALLBACK_NARROW = '질문이 여러 개라 한 단계씩 생각하기 어려워요. 하나만 골라서 다시 물어봐 주세요.';

let LADDER = FALLBACK_LADDER;
let NARROW_REQUEST = FALLBACK_NARROW;
let currentSession = null;
let streaming = false;

/* ─────────────── toast ─────────────── */
let toastTimer;
function toast(msg, bad = false, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms !== 0) toastTimer = setTimeout(() => (t.hidden = true), ms ?? (bad ? 6000 : 2800));
}
const errMsg = (e) => String(e?.message ?? e).replace(/^Error: /, '').replace(/^Error invoking remote method '[^']+': Error: /, '');

/* ─────────────── tabs ─────────────── */
function show(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'recall') renderRecall();
  if (view === 'dash') renderDash();
  if (view === 'explain') renderExplainHistory();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

/* ─────────────── 탐구 ─────────────── */

$('#gateHypothesis').addEventListener('input', (e) => {
  const n = e.target.value.trim().length;
  $('#hypCount').textContent = `${n}자`;
  $('#hypCount').style.color = n >= 20 ? 'var(--ok)' : 'var(--fg-3)';
  $('#gateStart').disabled = n < 20;
});
$('#gateQuestion').addEventListener('input', () => {
  $('#gateNext').disabled = $('#gateQuestion').value.trim().length < 5;
});

function updateGate() {
  $('#gateNext').disabled = $('#gateQuestion').value.trim().length < 5;
  $('#gateStart').disabled = $('#gateHypothesis').value.trim().length < 20;
}

function showGateStep(step) {
  $('#gateS1').hidden = step !== 1;
  $('#gateS2').hidden = step !== 2;
}

$('#gateNext').addEventListener('click', () => showGateStep(2));
$('#gateBack').addEventListener('click', () => showGateStep(1));

$('#newSessionBtn').addEventListener('click', () => {
  currentSession = null;
  $('#gate').hidden = false;
  $('#chatWrap').hidden = true;
  $('#gateErr').hidden = true;
  showGateStep(1);
  $$('.session-list li').forEach((li) => li.classList.remove('active'));
  $('#gateQuestion').focus();
});

$('#gateStart').addEventListener('click', async () => {
  const question = $('#gateQuestion').value.trim();
  const topic = $('#gateTopic').value.trim() || question.slice(0, 30);
  const hypothesis = $('#gateHypothesis').value.trim();
  try {
    const s = await window.api.session.create({ topic, question, hypothesis });
    $('#gateQuestion').value = $('#gateTopic').value = $('#gateHypothesis').value = '';
    $('#hypCount').textContent = '0자';
    updateGate();
    await loadSessions();
    await openSession(s.id);
    sendTurn(''); // 첫 턴은 가설을 자동 전송
  } catch (e) {
    $('#gateErr').textContent = errMsg(e);
    $('#gateErr').hidden = false;
  }
});

async function loadSessions() {
  const list = await window.api.session.list();
  const ul = $('#sessionList');
  ul.innerHTML = '';
  if (!list.length) {
    ul.append(el('div', 'empty', '아직 세션이 없어요'));
    return;
  }
  for (const s of list) {
    const li = el('li');
    li.classList.toggle('active', currentSession?.id === s.id);
    li.append(el('div', 'st', s.topic));
    li.append(
      el('div', 'sm', `${new Date(s.createdAt).toLocaleDateString('ko-KR')} · ${s.messages.length}턴 · 최대 L${s.maxHintLevel}`),
    );
    li.addEventListener('click', () => openSession(s.id));
    ul.append(li);
  }
}

async function openSession(sid) {
  currentSession = await window.api.session.get(sid);
  if (!currentSession) return;
  $('#gate').hidden = true;
  $('#chatWrap').hidden = false;
  $('#chatTopic').textContent = currentSession.topic;
  $('#chatQuestion').textContent = currentSession.question;
  renderLadder();
  renderMessages();
  updateComposerActions();
  await loadSessions();
}

function updateComposerActions() {
  const count = currentSession?.messages?.length ?? 0;
  $('#composerActions').hidden = count < 3;
}

function renderLadder() {
  const box = $('#ladder');
  box.innerHTML = '';
  for (const r of LADDER) {
    const b = el('button', `rung${r.level === 3 ? ' l3' : ''}`, `${r.badge} ${r.name}`);
    b.classList.toggle('on', currentSession?.hintLevel === r.level);
    b.title = r.directive;
    b.addEventListener('click', async () => {
      if (r.level === 3 && !confirm('정답을 보여드리면 생산적 고투가 끝나요.\n대시보드에 기록됩니다. 계속할까요?')) return;
      currentSession = await window.api.session.hint(currentSession.id, r.level);
      renderLadder();
      toast(`힌트 단계 → ${r.badge} ${r.name}`);
    });
    box.append(b);
  }
}

function renderMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  for (const m of currentSession.messages) {
    const d = el('div', `msg ${m.role}`);
    d.append(el('div', 'who', m.role === 'user' ? '나' : '튜터'));
    if (m.role === 'assistant') {
      const body = el('div', 'body');
      body.append(renderMarkdown(m.text));
      d.append(body);
    } else {
      d.append(el('div', 'body', m.text));
    }
    if (m.role === 'assistant' && m.hintLevel !== undefined)
      d.append(el('div', 'lvl', `힌트 ${LADDER[m.hintLevel]?.badge ?? 'L?'}`));
    box.append(d);
  }
  box.scrollTop = box.scrollHeight;
}

const composer = $('#composerInput');
composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('#sendBtn').click();
  }
});
$('#sendBtn').addEventListener('click', () => sendTurn(composer.value));

async function sendTurn(text) {
  if (streaming || !currentSession) return;
  const isFirst = currentSession.messages.length === 0;
  if (!isFirst && !text.trim()) return;

  streaming = true;
  $('#sendBtn').disabled = true;
  composer.value = '';

  const box = $('#messages');
  if (!isFirst) {
    const u = el('div', 'msg user');
    u.append(el('div', 'who', '나'));
    u.append(el('div', 'body', text));
    box.append(u);
  } else {
    const u = el('div', 'msg user');
    u.append(el('div', 'who', '나'));
    u.append(el('div', 'body', `[가설] ${currentSession.hypothesis}`));
    box.append(u);
  }

  const a = el('div', 'msg assistant');
  a.append(el('div', 'who', '튜터'));
  const body = el('div', 'body typing', '생각 중…');
  a.append(body);
  box.append(a);
  box.scrollTop = box.scrollHeight;

  const requestId = uuid();
  let acc = '';
  const off = window.api.onDelta(({ requestId: rid, delta }) => {
    if (rid !== requestId) return;
    acc += delta;
    body.classList.remove('typing');
    body.textContent = acc;
    box.scrollTop = box.scrollHeight;
  });

  try {
    const res = await window.api.session.send({ sessionId: currentSession.id, text, requestId });
    currentSession = res.session;
    body.classList.remove('typing');
    body.innerHTML = '';
    body.append(renderMarkdown(res.text || acc)); // ponytail: textContent during stream, renderMarkdown on complete
    a.append(el('div', 'lvl', `힌트 ${LADDER[currentSession.hintLevel]?.badge ?? 'L?'}`));
    if (res.tooMany) a.append(narrowNotice(res.questions));
    await loadSessions();
  } catch (e) {
    body.classList.remove('typing');
    body.textContent = `⚠︎ ${errMsg(e)}`;
    toast(errMsg(e), true);
  } finally {
    off();
    streaming = false;
    $('#sendBtn').disabled = false;
    updateComposerActions();
    box.scrollTop = box.scrollHeight;
  }
}

/** 튜터가 한 턴에 질문을 여러 개 던졌을 때의 되돌림 장치. */
function narrowNotice(n) {
  const box = el('div', 'narrow');
  box.append(el('span', '', `질문이 ${n}개예요. 한 번에 하나씩 가는 게 학습에 맞아요.`));
  const btn = el('button', 'ghost small', '하나만 물어봐 달라고 하기');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    sendTurn(NARROW_REQUEST);
  });
  box.append(btn);
  return box;
}

$('#toExplainBtn').addEventListener('click', () => {
  if (currentSession) $('#exTopic').value = currentSession.topic;
  show('explain');
  $('#exText').focus();
});

$('#makeCardsBtn').addEventListener('click', async () => {
  if (!currentSession) return;
  const btn = $('#makeCardsBtn');
  btn.disabled = true;
  btn.textContent = '만드는 중…';
  try {
    const cards = await window.api.cards.generate({ sessionId: currentSession.id, count: 5 });
    toast(`인출 카드 ${cards.length}장을 만들었어요`);
    await refreshDuePill();
    show('recall');
  } catch (e) {
    toast(errMsg(e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = '인출 카드 만들기';
  }
});

$('#obsSessionBtn').addEventListener('click', async () => {
  if (!currentSession) return;
  const btn = $('#obsSessionBtn');
  btn.disabled = true;
  btn.textContent = '저장 중…';
  try {
    const r = await window.api.obsidian.exportSession(currentSession.id);
    toast(`Obsidian에 저장했어요 — ${r.note.split('/').pop()}`);
    btn.textContent = '저장됨 ✓';
  } catch (e) {
    toast(errMsg(e), true);
    btn.disabled = false;
    btn.textContent = 'Obsidian 저장';
  }
});

/* ─────────────── 설명 ─────────────── */

$('#exText').addEventListener('input', (e) => {
  const n = e.target.value.trim().length;
  $('#exCount').textContent = `${n}자`;
  $('#exCount').style.color = n >= 60 ? 'var(--ok)' : 'var(--fg-3)';
});

$('#exGradeBtn').addEventListener('click', async () => {
  const btn = $('#exGradeBtn');
  btn.disabled = true;
  btn.textContent = '진단 중…';
  $('#exResult').innerHTML = '';
  try {
    const rec = await window.api.explain.grade({
      sessionId: currentSession?.id ?? null,
      topic: $('#exTopic').value.trim() || '(미지정)',
      explanation: $('#exText').value,
    });
    renderFindings(rec);
    renderObsidianRow(rec);
    renderExplainHistory();
  } catch (e) {
    toast(errMsg(e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = '진단 받기';
  }
});

const KIND_LABEL = { correct: '정확', error: '오류', gap: '누락', vague: '뭉갬' };

function renderFindings(rec) {
  const out = $('#exResult');
  out.innerHTML = '';
  const bar = el('div', 'scorebar');
  const sc = el('div', 'score', String(rec.score));
  sc.style.color = rec.score >= 75 ? 'var(--ok)' : rec.score >= 50 ? 'var(--warn)' : 'var(--danger)';
  bar.append(sc, el('div', 'muted', rec.verdict));
  out.append(bar);

  const order = { error: 0, gap: 1, vague: 2, correct: 3 };
  const sorted = [...(rec.findings || [])].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  for (const f of sorted) {
    const d = el('div', `finding ${f.kind}`);
    d.append(el('div', 'kind', KIND_LABEL[f.kind] ?? f.kind));
    if (f.quote) d.append(el('div', 'quote', `“${f.quote}”`));
    d.append(el('div', '', f.note));
    if (f.fix && f.kind !== 'correct') d.append(el('div', 'fix', `↳ ${f.fix}`));
    out.append(d);
  }
  if (rec.concepts?.length) out.append(el('div', 'muted small', `개념: ${rec.concepts.join(' · ')}`));
}

/** 진단 결과 아래의 Obsidian 저장 줄. 자동 저장이 켜져 있으면 이미 끝나 있다. */
function renderObsidianRow(rec) {
  const out = $('#exResult');

  const done = (r) => {
    const box = el('div', 'exported');
    const n = r.note.split('/').pop();
    box.append(
      el('span', '', `Obsidian에 저장했어요 — ${n}` + (r.concepts.length ? ` · 개념 ${r.concepts.length}개 연결` : '')),
    );
    const b = el('button', 'ghost small', 'Finder에서 열기');
    b.addEventListener('click', () => window.api.obsidian.reveal(r.note));
    box.append(b);
    out.append(box);
  };

  if (rec.exported) return done(rec.exported);
  if (rec.exportError) toast(`Obsidian 저장 실패: ${rec.exportError}`, true);

  const row = el('div', 'row');
  row.style.marginTop = '14px';
  const btn = el('button', 'ghost small', 'Obsidian에 저장');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '저장 중…';
    try {
      const r = await window.api.obsidian.export(rec.id);
      row.remove();
      done(r);
    } catch (e) {
      toast(errMsg(e), true);
      btn.disabled = false;
      btn.textContent = 'Obsidian에 저장';
    }
  });
  row.append(btn);
  out.append(row);

  // 개발자 친화 개념 노트 생성 버튼
  const noteBtn = el('button', 'ghost small', 'Obsidian 개념 노트 생성');
  noteBtn.style.marginTop = '8px';
  noteBtn.addEventListener('click', async () => {
    noteBtn.disabled = true;
    noteBtn.textContent = '생성 중…';
    try {
      const r = await window.api.obsidian.buildConceptNote({
        concept: document.getElementById('exTopic').value.trim() || '개념',
        sessionIds: [],
        language: 'JavaScript',
      });
      toast(`Obsidian 개념 노트 생성됨: ${r.filePath.split('/').pop()}`);
      noteBtn.textContent = '노트 생성 완료 ✓';
    } catch (e) {
      toast(errMsg(e), true);
      noteBtn.disabled = false;
      noteBtn.textContent = 'Obsidian 개념 노트 생성';
    }
  });
  out.append(noteBtn);
}

async function renderExplainHistory() {
  const list = await window.api.explain.list();
  const box = $('#exHistory');
  box.innerHTML = '';
  if (!list.length) return;
  box.append(el('div', 'sidebar-label', '지난 자기설명'));
  for (const e of list.slice(0, 15)) {
    const row = el('div', 'mini');
    row.append(el('div', 'q', `${e.topic} — ${e.verdict || ''}`));
    row.append(el('div', 'd', `${e.score}점 · ${new Date(e.createdAt).toLocaleDateString('ko-KR')}`));
    box.append(row);
  }
}

/* ─────────────── 인출 ─────────────── */

let recallQueue = [];
let recallIdx = 0;

async function renderRecall() {
  recallQueue = await window.api.cards.due();
  recallIdx = 0;
  renderCurrentCard();
  renderAllCards();
  await refreshDuePill();
}

function renderCurrentCard() {
  const area = $('#recallArea');
  area.innerHTML = '';
  const card = recallQueue[recallIdx];
  if (!card) {
    area.append(el('div', 'empty', recallQueue.length ? '오늘 복습 완료' : '지금 복습할 카드가 없어요. 탐구 세션에서 카드를 만들어보세요.'));
    return;
  }

  // 진행 바
  const count = el('div', 'fc-count', `${recallIdx + 1} / ${recallQueue.length}`);
  const prog = el('div', 'fc-progress');
  const fill = el('div', 'fc-progress-fill');
  fill.style.width = `${Math.round((recallIdx / recallQueue.length) * 100)}%`;
  prog.append(fill);
  area.append(count, prog);

  // 플래시카드 (.card class for backward-compat test selector)
  const fcWrap = el('div', 'flashcard-wrap card');
  const fc = el('div', 'flashcard');
  const front = el('div', 'flashcard-face flashcard-front');
  front.append(el('div', 'fc-label', `${card.concept} · ${card.kind}`));
  front.append(el('div', '', card.front));
  const back = el('div', 'flashcard-face flashcard-back');
  back.append(el('div', 'fc-label', '정답'));
  // card.back populated lazily on flip to keep textContent clean before reveal
  fc.append(front, back);
  fcWrap.append(fc);

  // 정답 보기 버튼
  const showBtn = el('button', 'primary', '정답 보기');
  showBtn.style.marginTop = '16px';
  fcWrap.append(showBtn);

  // 답 작성 + 채점 영역 (처음엔 숨김, DOM에 미리 존재)
  const answerArea = el('div');
  answerArea.hidden = true;
  const ta = el('textarea');
  ta.rows = 3;
  ta.placeholder = '기억에서 꺼낸 내용을 적어도 되고, 비워둔 채 채점받아도 돼요.';
  ta.style.marginTop = '14px';
  const row = el('div', 'row between');
  row.style.marginTop = '10px';
  const skip = el('button', 'ghost small', '모르겠어요 (0점)');
  const submit = el('button', 'primary', '채점');
  row.append(skip, submit);
  answerArea.append(ta, row);
  fcWrap.append(answerArea);
  area.append(fcWrap);

  const doGrade = async (answer) => {
    submit.disabled = skip.disabled = ta.disabled = true;
    submit.textContent = '채점 중…';
    try {
      const r = await window.api.cards.answer({ cardId: card.id, answer });
      const out = el('div', 'grade-out');
      const head = el('div', 'row');
      const badge = el('span', `gbadge ${r.grade >= 3 ? 'pass' : 'fail'}`, `${r.grade} / 5`);
      head.append(badge, el('span', '', r.feedback));
      out.append(head);
      if (r.missing?.length) out.append(el('div', 'muted small', `빠진 것: ${r.missing.join(', ')}`));
      out.append(el('div', 'reveal', card.back));
      const nextDue = new Date(r.card.due);
      out.append(el('div', 'muted small', `다음 복습: ${nextDue.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}`));
      const next = el('button', 'primary', recallIdx + 1 < recallQueue.length ? '다음 카드' : '완료');
      next.style.marginTop = '12px';
      next.addEventListener('click', () => { recallIdx++; renderCurrentCard(); renderAllCards(); refreshDuePill(); });
      out.append(next);
      answerArea.append(out);
      next.focus();
    } catch (e) {
      toast(errMsg(e), true);
      submit.disabled = skip.disabled = ta.disabled = false;
      submit.textContent = '채점';
    }
  };

  submit.addEventListener('click', () => doGrade(ta.value.trim()));
  skip.addEventListener('click', () => doGrade(''));

  showBtn.addEventListener('click', () => {
    back.append(el('div', '', card.back));
    fc.classList.add('flipped');
    showBtn.hidden = true;
    answerArea.hidden = false;
    ta.focus();
  });
}

async function renderAllCards() {
  const [cards, sessions] = await Promise.all([
    window.api.cards.all(),
    window.api.session.list().catch(() => []),
  ]);
  const box = $('#allCards');
  box.innerHTML = '';
  if (!cards.length) {
    box.append(el('div', 'empty', '카드 없음'));
    return;
  }

  const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s.topic]));

  const groups = {};
  for (const c of [...cards].sort((a, b) => a.due - b.due)) {
    const key = c.sessionId ?? '__none__';
    (groups[key] ??= []).push(c);
  }

  for (const [sid, group] of Object.entries(groups)) {
    const topic = sessionMap[sid] ?? '(세션 없음)';
    box.append(el('div', 'sidebar-label', topic));
    for (const c of group) {
      const row = el('div', 'mini');
      row.append(el('div', 'q', c.front));
      const right = el('div', 'row');
      right.style.gap = '8px';
      const overdue = c.due < Date.now();
      const d = el('div', 'd', overdue ? '지금 복습' : new Date(c.due).toLocaleDateString('ko-KR'));
      if (overdue) d.style.color = 'var(--accent)';
      const delBtn = el('button', 'ghost small', '×');
      delBtn.title = '카드 삭제';
      delBtn.style.cssText = 'padding:2px 6px;font-size:14px;color:var(--fg-3);border:none;';
      delBtn.addEventListener('click', async () => {
        await window.api.cards.delete(c.id);
        row.remove();
        await refreshDuePill();
      });
      right.append(d, delBtn);
      row.append(right);
      box.append(row);
    }
  }
}

async function refreshDuePill() {
  const n = (await window.api.cards.due()).length;
  const p = $('#duePill');
  p.textContent = String(n);
  p.hidden = n === 0;
}

/* ─────────────── 대시보드 ─────────────── */

async function renderDash() {
  const { stats: s, antipatterns: flags } = await window.api.stats.get();

  const kpi = (v, k) => {
    const d = el('div', 'kpi');
    d.append(el('div', 'v', v));
    d.append(el('div', 'k', k));
    return d;
  };
  const K = $('#kpis');
  K.innerHTML = '';
  K.append(
    kpi(String(s.sessions), '학습 세션'),
    kpi(s.recallRate === null ? '—' : `${s.recallRate}%`, `인출 성공률 (${s.recallTotal}회)`),
    kpi(s.explainAvg === null ? '—' : `${s.explainAvg}`, `자기설명 평균 (${s.explainCount}회)`),
    kpi(String(s.due), '오늘 복습'),
    kpi(s.l3Rate === null ? '—' : `${s.l3Rate}%`, '정답 조기 공개율'),
  );

  const days = Object.entries(s.daily);
  const max = Math.max(1, ...days.map(([, v]) => v));
  const sp = $('#spark');
  sp.innerHTML = '';
  for (const [d, v] of days) {
    const b = el('div');
    b.style.height = `${Math.round((v / max) * 100)}%`;
    if (v > 0) b.classList.add('hot');
    b.title = `${d}: ${v}건`;
    sp.append(b);
  }

  const F = $('#flags');
  F.innerHTML = '';
  if (!flags.length) F.append(el('div', 'empty', '데이터가 더 쌓이면 표시돼요'));
  for (const f of flags) {
    const d = el('div', `flag ${f.level}`);
    d.append(el('div', 't', f.title));
    d.append(el('div', 'b', f.body));
    F.append(d);
  }

  // 망각 현황 (에빙하우스)
  const fStatus = await window.api.forgetting.status();
  const FS = $('#forgettingStatus');
  if (FS) {
    FS.innerHTML = '';
    if (!fStatus.length) {
      FS.append(el('div', 'empty', '학습 세션이 없어요'));
    } else {
      for (const s of fStatus.slice(0, 6)) {
        const pct = s.retention === null ? null : Math.round(s.retention * 100);
        const row = el('div', 'retention-row');
        const label = el('div', '', s.topic);
        row.append(label);
        if (pct !== null) {
          const barWrap = el('div', 'retention-bar-wrap');
          const bar = el('div', 'retention-bar');
          bar.style.width = `${pct}%`;
          bar.style.background = pct >= 80 ? 'var(--ok)' : pct >= 60 ? 'var(--warn)' : 'var(--danger)';
          barWrap.append(bar);
          const note = el('span', 'muted small', `${pct}%${s.dueForRecall ? ' · 복습 필요' : ''}`);
          if (s.dueForRecall) note.style.color = 'var(--warn)';
          row.append(barWrap, note);
        }
        FS.append(row);
      }
    }
  }

  const T = $('#conceptTable');
  T.innerHTML = '';
  if (!s.concepts.length) {
    T.append(el('div', 'empty', '인출 기록이 없어요'));
  } else {
    const tb = el('table');
    tb.innerHTML = '<thead><tr><th>개념</th><th style="text-align:right">시도</th><th style="text-align:right">성공률</th></tr></thead>';
    const body = el('tbody');
    for (const c of s.concepts) {
      const tr = el('tr');
      tr.append(el('td', '', c.concept));
      tr.append(el('td', 'num', String(c.total)));
      const rate = el('td', `num ${c.rate < 60 ? 'bad' : c.rate >= 80 ? 'good' : ''}`, `${c.rate}%`);
      tr.append(rate);
      body.append(tr);
    }
    tb.append(body);
    T.append(tb);
  }
}

$('#coachBtn').addEventListener('click', async () => {
  const b = $('#coachBtn');
  b.disabled = true;
  b.textContent = '생성 중…';
  try {
    $('#coach').textContent = await window.api.stats.coach();
  } catch (e) {
    toast(errMsg(e), true);
  } finally {
    b.disabled = false;
    b.textContent = '생성';
  }
});

/* ─────────────── 설정 ─────────────── */

$('#settingsBtn').addEventListener('click', async () => {
  const s = await window.api.settings.get();
  $('#setLevel').value = s.learnerLevel;
  $('#setModel').value = s.model;
  $('#healthOut').textContent = '';
  $('#obsFolder').value = s.obsidianFolder ?? 'Learn with Claude';
  $('#obsAuto').checked = !!s.obsidianAuto;
  $('#obsCards').checked = !!s.obsidianCards;
  $('#settingsModal').hidden = false;
  renderDataInfo();
  renderObsInfo();
  renderProjectInfo(s);
  renderUsageInfo(s);
});

function renderProjectInfo(s) {
  const box = $('#projectInfo');
  if (!box) return;
  box.textContent = s.projectPath ? s.projectPath : '선택된 프로젝트 없음 — 선택하면 Claude가 코드를 직접 읽고 수정할 수 있어요.';
}

$('#projectPickBtn')?.addEventListener('click', async () => {
  const p = await window.api.project.pick();
  if (p) {
    toast(`프로젝트 설정: ${p.split('/').pop()}`);
    const s = await window.api.settings.get();
    renderProjectInfo(s);
  }
});
$('#projectClearBtn')?.addEventListener('click', async () => {
  await window.api.settings.set({ projectPath: '' });
  const s = await window.api.settings.get();
  renderProjectInfo(s);
  toast('프로젝트 해제됨');
});

async function renderObsInfo() {
  const r = await window.api.obsidian.check();
  const box = $('#obsInfo');
  box.innerHTML = '';
  if (!r.path) {
    box.append(el('div', '', '보관함이 선택되지 않았어요. 선택하면 학습 노트와 개념 허브가 만들어져요.'));
    return;
  }
  box.append(el('code', '', r.path));
  if (!r.ok) box.append(el('div', 'datanote', r.reason));
  else if (r.warning) box.append(el('div', 'datanote', r.warning));
}

$('#obsPickBtn').addEventListener('click', async () => {
  try {
    const r = await window.api.obsidian.pick();
    if (r) toast('보관함을 설정했어요');
    renderObsInfo();
  } catch (e) {
    toast(errMsg(e), true);
  }
});

async function runBuildDag(btn, resultEl) {
  btn.disabled = true;
  btn.textContent = '분석 중…';
  if (resultEl) resultEl.textContent = '';
  try {
    const r = await window.api.obsidian.buildDag();
    const msg = r.edges ? `개념 관계 ${r.edges}개 연결 완료` : '연결할 관계를 찾지 못했어요';
    toast(msg);
    if (resultEl) resultEl.textContent = msg;
  } catch (e) {
    toast(errMsg(e), true);
    if (resultEl) resultEl.textContent = errMsg(e);
  } finally {
    btn.disabled = false;
    btn.textContent = btn === $('#obsDagBtn') ? '개념 관계 그래프 생성' : '그래프 생성';
  }
}

$('#obsDagBtn').addEventListener('click', () => runBuildDag($('#obsDagBtn'), null));
$('#dagBtn').addEventListener('click', () => runBuildDag($('#dagBtn'), $('#dagResult')));

async function renderDataInfo() {
  const d = await window.api.data.info();
  const kb = (d.bytes / 1024).toFixed(1);
  const box = $('#dataInfo');
  box.innerHTML = '';
  box.append(
    el('div', '', `세션 ${d.counts.sessions} · 카드 ${d.counts.cards} · 설명 ${d.counts.explains} · ${kb} KB`),
    el('div', '', `형식 v${d.version} · 백업 ${d.backups.length}개`),
  );
  const code = el('code', '', d.dir);
  box.append(code);
  box.append(el('div', '', '앱 번들 바깥이라 업데이트·재설치로 지워지지 않아요.'));

  const notes = $('#dataNotes');
  notes.innerHTML = '';
  for (const n of d.notes) notes.append(el('div', 'datanote', n));
}

$('#backupBtn').addEventListener('click', async () => {
  try {
    const name = await window.api.data.backup();
    toast(`백업 생성: ${name}`);
    renderDataInfo();
  } catch (e) {
    toast(errMsg(e), true);
  }
});

$('#revealBtn').addEventListener('click', () => window.api.data.reveal());
$('#settingsModal').addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') $('#settingsModal').hidden = true;
});
$('#setSave').addEventListener('click', async () => {
  await window.api.settings.set({
    learnerLevel: $('#setLevel').value,
    model: $('#setModel').value,
    obsidianFolder: $('#obsFolder').value.trim() || 'Learn with Claude',
    obsidianAuto: $('#obsAuto').checked,
    obsidianCards: $('#obsCards').checked,
  });
  $('#settingsModal').hidden = true;
  toast('저장했어요');
});
$('#healthBtn').addEventListener('click', async () => {
  $('#healthOut').textContent = '확인 중…';
  const r = await window.api.health();
  $('#healthOut').textContent = r.ok
    ? `✓ 연결됨 (${r.model})`
    : `✗ ${r.error}\n터미널에서 'claude' 로그인이 되어 있는지 확인하세요.`;
});

async function renderUsageInfo(settings) {
  // Claude 버전
  const ver = await window.api.claude.version();
  $('#claudeVersionOut').textContent = `Claude Code: ${ver}`;

  // 누적 토큰 사용량
  const u = settings?.totalUsage ?? { input: 0, output: 0 };
  const hasUsage = u.input > 0 || u.output > 0;
  $('#usageOut').textContent = hasUsage
    ? `누적 토큰 — 입력 ${u.input.toLocaleString()} / 출력 ${u.output.toLocaleString()}`
    : '토큰 사용량 추적 중 (대화 후 갱신)';
}

$('#usageResetBtn').addEventListener('click', async () => {
  await window.api.usage.reset();
  toast('사용량 초기화했어요');
  const s = await window.api.settings.get();
  renderUsageInfo(s);
});

$('#usageLinkBtn').addEventListener('click', () => {
  window.open('https://claude.ai/settings/limits');
});

/* ─────────────── 온보딩 ─────────────── */

function obSetConnState(state, iconText) {
  const ind = $('#ob-conn-indicator');
  const icon = $('#ob-conn-icon');
  if (ind) ind.dataset.state = state;
  if (icon && iconText) icon.textContent = iconText;
}

function obShowHealthBox(state, html) {
  const box = $('#ob-health-result');
  if (!box) return;
  box.dataset.state = state;
  box.innerHTML = html;
  box.hidden = false;
}

async function obRunHealthCheck() {
  const btn = $('#ob2Check');
  obSetConnState('checking', '↻');
  if (btn) btn.disabled = true;
  $('#ob-health-result').hidden = true;

  const r = await window.api.health();

  if (r.ok) {
    obSetConnState('ok', '✓');
    obShowHealthBox('ok', `연결됨 — ${r.model}`);
    setTimeout(() => goObStep(3), 900);
  } else {
    obSetConnState('fail', '✗');
    obShowHealthBox('fail',
      `연결 실패<br><span style="font-size:0.88rem;opacity:0.85">${r.error}</span><br>` +
      `<span style="font-size:0.85rem;opacity:0.7">터미널에서 <code style="background:#3a1f1b;padding:1px 5px;border-radius:4px">claude</code> 로그인을 확인하세요</span>`
    );
    if (btn) btn.disabled = false;
    if (btn) btn.textContent = '다시 확인';
  }
}

function goObStep(n) {
  $$('.ob-step').forEach((s, i) => { s.hidden = i !== n - 1; s.classList.toggle('active', i === n - 1); });
  $$('.ob-dot').forEach((d, i) => d.classList.toggle('active', i === n - 1));
  if (n === 2) obRunHealthCheck();
}

function showObSubstep(id) {
  ['ob3-ask', 'ob3-download', 'ob3-pick'].forEach((s) => {
    document.getElementById(s).hidden = s !== id;
  });
}

function initOnboarding(settings) {
  if (settings.onboardingDone) return;

  $('#onboarding').hidden = false;

  // 스텝 1
  $('#ob1Next').onclick = () => goObStep(2);

  // 스텝 2: Claude 연결 확인
  $('#ob2Check').onclick = () => obRunHealthCheck();
  $('#ob2Skip').onclick = () => goObStep(3);

  // 스텝 3: Obsidian
  $('#ob3HasObs').onclick = () => showObSubstep('ob3-pick');
  $('#ob3NoObs').onclick = () => showObSubstep('ob3-download');
  $('#ob3AfterInstall').onclick = () => showObSubstep('ob3-pick');
  $('#obDownloadLink').onclick = () => window.open('https://obsidian.md');
  $('#ob3Pick').onclick = async () => {
    try {
      const r = await window.api.obsidian.pick();
      if (r) {
        $('#ob3VaultStatus').textContent = `보관함 연결됨: ${r.path}`;
        $('#ob3VaultStatus').style.color = 'var(--ok)';
        $('#ob3Done').disabled = false;
      }
    } catch (e) {
      $('#ob3VaultStatus').textContent = errMsg(e);
      $('#ob3VaultStatus').style.color = 'var(--danger)';
    }
  };
  $('#ob3Done').onclick = () => goObStep(4);
  $('#ob3Skip').onclick = () => goObStep(4);

  // 스텝 4: 완료
  $('#ob4Done').onclick = async () => {
    await window.api.onboarding.complete();
    $('#onboarding').hidden = true;
  };
}

function maybeShowFillBtn(sessions) {
  $('#gateFill').hidden = sessions.length > 0;
}

$('#gateFill')?.addEventListener('click', () => {
  $('#gateQuestion').value = 'Node.js 이벤트 루프에서 microtask와 macrotask는 왜 순서가 다른가?';
  $('#gateTopic').value = 'Node 이벤트 루프';
  $('#gateHypothesis').value =
    'microtask는 현재 task가 끝나자마자 실행되고, macrotask는 다음 루프에서 실행된다고 생각해요. 왜 이렇게 분리됐는지는 모르겠어요.';
  $('#hypCount').textContent = `${$('#gateHypothesis').value.trim().length}자`;
  $('#hypCount').style.color = 'var(--ok)';
  updateGate();
});

/* ─────────────── boot ─────────────── */

/**
 * Cmd+R 은 렌더러만 새로고침한다. 메인 프로세스는 예전 코드로 남아 있어서
 * 새로 추가한 IPC 채널이 없을 수 있다 — 그때 부팅 전체가 멈추면 안 된다.
 * 각 단계를 독립적으로 실패시키고, 원인을 사용자에게 정확히 알려준다.
 */
const isMissingHandler = (e) => /No handler registered/i.test(String(e?.message ?? e));

(async () => {
  const stale = [];
  const step = async (label, fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      if (isMissingHandler(e)) stale.push(label);
      else toast(`${label}: ${errMsg(e)}`, true);
      return fallback;
    }
  };

  const settings = await step('설정', () => window.api.settings.get(), {});
  initOnboarding(settings);

  LADDER = await step('힌트 사다리', () => window.api.ladder(), FALLBACK_LADDER);
  NARROW_REQUEST = await step('되돌림 문구', () => window.api.narrowRequest(), FALLBACK_NARROW);
  await step('세션 목록', loadSessions);
  await step('복습 카드', refreshDuePill);
  const list = await step('세션 목록', () => window.api.session.list(), []);
  maybeShowFillBtn(list);
  if (list.length) await step('세션 열기', () => openSession(list[0].id));

  if (stale.length) {
    toast(
      `메인 프로세스가 예전 코드로 실행 중이에요 (${stale.join(', ')}). ` +
        'Cmd+R 새로고침으로는 반영되지 않아요 — Cmd+Q 로 완전히 종료한 뒤 npm start 를 다시 실행해 주세요.',
      true,
      0, // 자동으로 사라지지 않게
    );
  }
})();
