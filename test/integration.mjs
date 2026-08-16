/**
 * 통합 스모크 테스트.
 *
 * Electron 런타임과 Agent SDK를 스텁으로 대체하고
 *   main.js(IPC 등록) → preload.cjs(contextBridge) → renderer/app.js(jsdom)
 * 전 구간을 실제로 구동한다. 실제 창을 띄우지는 못하지만
 * IPC 계약 불일치, 렌더러 런타임 에러, 워크플로 게이트를 잡아낸다.
 *
 * 실행: npm test
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');
const { handlers, state } = electron.__test;

const pass = [];
const ok = (m) => pass.push(m);

const USERDATA = process.env.TEST_USERDATA;
assert.ok(USERDATA, 'test/setup.mjs 없이 실행됐어요. `npm test`로 실행하세요.');

/* ── 1. 메인 프로세스 부팅 ── */
await import(pathToFileURL(path.join(ROOT, 'src/main/main.js')).href);
await new Promise((r) => setTimeout(r, 60));

assert.ok(state.windowOpts, 'BrowserWindow 생성 안 됨');
assert.equal(state.windowOpts.webPreferences.contextIsolation, true);
assert.equal(state.windowOpts.webPreferences.nodeIntegration, false);
assert.ok(state.loadedFile?.endsWith('index.html'), 'index.html 로드 안 됨');
assert.ok(fs.existsSync(state.loadedFile), `로드 경로 없음: ${state.loadedFile}`);
assert.ok(fs.existsSync(state.windowOpts.webPreferences.preload), 'preload 경로 없음');
ok(`메인 부팅 · IPC 핸들러 ${handlers.size}개 등록`);

/* ── 2. preload 브리지 ↔ main 핸들러 계약 ── */
require(path.join(ROOT, 'src/main/preload.cjs'));
const api = global.__bridge.value;
assert.equal(global.__bridge.key, 'api');

const walk = (o, p = []) =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'function' ? [[...p, k].join('.')] : walk(v, [...p, k]),
  );
const surface = walk(api);
assert.ok(surface.length >= 15, '브리지 표면이 너무 작음');
ok(`preload 브리지 ${surface.length}개 노출`);

/* ── 3. 렌더러를 jsdom에서 실제 구동 ── */
const css = fs.readFileSync(path.join(ROOT, 'src/renderer/styles.css'), 'utf8');
const html = fs
  .readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  // <link> 는 jsdom 이 로드하지 않으므로 인라인으로 주입 —
  // hidden 속성이 실제로 먹히는지 계산된 스타일로 검증하기 위해 필요하다.
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>${css}</style>`);
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
window.api = api;
window.confirm = () => true;

const appJs = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
window.eval(appJs);
const tick = () => new Promise((r) => setTimeout(r, 40));
await tick();
assert.deepEqual(errors, [], 'renderer 런타임 에러');
const $ = (s) => window.document.querySelector(s);
ok('렌더러 부팅 · 에러 0건');

/* ── 3b. [hidden] 무력화 회귀 검사 (정적 분석) ──
   .modal{display:flex} 같은 author 규칙은 UA 의 [hidden]{display:none} 을 이긴다.
   그 결과 el.hidden = true 로 숨긴 설정 모달·채팅창·due 뱃지가 화면에 그대로 남는 버그가 있었다.

   주의: jsdom 의 getComputedStyle 은 이 캐스케이드를 모델링하지 못해
   런타임 검증으로는 잡히지 않는다. 그래서 CSS 를 직접 파싱해 검사한다. */
{
  const hiddenEls = [...window.document.querySelectorAll('[hidden]')].map(
    (e) => e.id || e.className,
  );
  assert.ok(hiddenEls.length >= 3, 'hidden 요소 샘플 부족');

  const guard = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css);
  assert.ok(
    guard,
    `styles.css 에 "[hidden]{display:none!important}" 가 없어요.\n` +
      `.modal/.chat-wrap/.pill 처럼 display 를 지정한 요소들(${hiddenEls.join(', ')})이 숨겨지지 않습니다.`,
  );

  // display 를 지정하면서 hidden 으로도 제어되는 클래스들이 실제로 존재하는지 확인
  for (const cls of ['.modal', '.chat-wrap', '.pill']) {
    assert.ok(
      new RegExp(`\\${cls}\\s*\\{[^}]*display\\s*:`).test(css),
      `${cls} 가 display 를 지정하지 않음 — 가드 규칙 전제가 바뀜`,
    );
  }
  ok(`[hidden] 가드 규칙 존재 (${hiddenEls.length}개 요소 보호)`);
}

/* ── 4. 탭 전환이 모든 뷰에서 동작하는가 ── */
for (const v of ['explain', 'recall', 'dash', 'inquiry']) {
  window.document.querySelector(`.tab[data-view="${v}"]`).click();
  await tick();
  assert.ok($(`#view-${v}`).classList.contains('active'), `${v} 뷰 활성화 실패`);
}
assert.deepEqual(errors, [], '탭 전환 중 에러');
ok('탭 4개 전환 정상');

/* ── 5. 레버 1 — 가설 게이트가 실제로 막는가 ── */
$('#gateQuestion').value = '왜 microtask가 먼저 실행되나?';
$('#gateQuestion').dispatchEvent(new window.Event('input'));
$('#gateHypothesis').value = '몰라요';
$('#gateHypothesis').dispatchEvent(new window.Event('input'));
await tick();
assert.equal($('#gateStart').disabled, true, '짧은 가설인데 시작 버튼이 열림');

await assert.rejects(
  () => api.session.create({ topic: 't', question: 'q', hypothesis: '짧음' }),
  /20자 이상/,
  '메인 쪽 가설 검증이 없음',
);
ok('레버1 게이트: UI + 메인 양쪽에서 차단됨');

/* ── 6. 레버 1+2 — 세션 시작 → 첫 턴 자동 전송 → 스트리밍 ── */
$('#gateTopic').value = 'Node 이벤트 루프';
$('#gateHypothesis').value = '마이크로태스크 큐가 매 틱마다 완전히 비워지기 때문이라고 생각해요';
$('#gateHypothesis').dispatchEvent(new window.Event('input'));
await tick();
assert.equal($('#gateStart').disabled, false, '유효한 가설인데 버튼이 잠김');

$('#gateStart').click();
await new Promise((r) => setTimeout(r, 250));
assert.ok($('#gate').hidden, '게이트가 안 닫힘');
assert.equal($('#chatTopic').textContent, 'Node 이벤트 루프');

const msgs = [...window.document.querySelectorAll('.msg')];
assert.equal(msgs.length, 2, `메시지 2개여야 하는데 ${msgs.length}개`);
assert.ok(msgs[0].textContent.includes('[가설]'), '첫 턴이 가설로 전송되지 않음');
assert.ok(msgs[1].querySelector('.body').textContent.includes('setTimeout'), '튜터 응답 미표시');
assert.ok(!msgs[1].querySelector('.body').classList.contains('typing'), 'typing 상태가 안 풀림');
assert.equal($('#sessionList').children.length, 1, '세션 목록 미갱신');
ok('레버1+2: 가설 자동 전송 → 스트리밍 응답 → 목록 갱신');

/* 첫 SDK 호출이 툴 없이, 커스텀 시스템 프롬프트로 나갔는가 */
const sdk = await import('@anthropic-ai/claude-agent-sdk');
const first = sdk.__calls[sdk.__calls.length - 1];
assert.deepEqual(first.options.allowedTools, [], '툴이 허용됨');
assert.deepEqual(first.options.settingSources, [], 'CLAUDE.md 로드됨');
assert.ok(first.options.systemPrompt.includes('소크라테스식 튜터'));
assert.ok(first.prompt.includes('[HINT_LEVEL=0]'), '힌트 레벨 미주입');
assert.equal(first.options.includePartialMessages, true);
ok('SDK 호출: 툴 0개 · 커스텀 시스템 프롬프트 · HINT_LEVEL=0');

/* ── 7. 레버 2 — 힌트 사다리 ── */
const rungs = [...window.document.querySelectorAll('.rung')];
assert.equal(rungs.length, 4, '사다리 4단이 아님');
assert.ok(rungs[0].classList.contains('on'), '초기값이 L0이 아님');
rungs[3].click(); // L3 (confirm은 true로 스텁)
await tick();
// renderLadder()가 DOM을 다시 그리므로 재조회
assert.ok(
  [...window.document.querySelectorAll('.rung')][3].classList.contains('on'),
  'L3 전환 실패',
);

$('#composerInput').value = '정답 알려주세요';
$('#sendBtn').click();
await new Promise((r) => setTimeout(r, 250));
const l3call = sdk.__calls[sdk.__calls.length - 1];
assert.ok(l3call.prompt.includes('[HINT_LEVEL=3]'), 'L3가 프롬프트에 반영 안 됨');
assert.equal(l3call.options.resume, 'sdk-session-1', '세션 resume 미적용');
ok('레버2: L0→L3 사다리 + 멀티턴 resume');

/* ── 7b. "한 턴에 질문 하나" 백스톱 ── */
{
  // L0 으로 되돌린 뒤 질문 3개짜리 응답을 유도
  [...window.document.querySelectorAll('.rung')][0].click();
  await tick();
  $('#composerInput').value = '__MULTIQ__';
  $('#sendBtn').click();
  await new Promise((r) => setTimeout(r, 300));

  const last = [...window.document.querySelectorAll('.msg.assistant')].pop();
  const notice = last.querySelector('.narrow');
  assert.ok(notice, '질문 3개 응답인데 되돌림 안내가 안 뜸');
  assert.ok(notice.textContent.includes('질문이 3개'), `카운트 오류: ${notice.textContent}`);

  notice.querySelector('button').click();
  await new Promise((r) => setTimeout(r, 300));
  const sent = [...window.document.querySelectorAll('.msg.user')].pop().textContent;
  assert.ok(sent.includes('하나만 골라서'), '되돌림 요청이 전송되지 않음');
  assert.ok(
    !window.document.querySelectorAll('.msg.assistant')[
      window.document.querySelectorAll('.msg.assistant').length - 1
    ].querySelector('.narrow'),
    '질문 1개 응답에는 안내가 뜨면 안 됨',
  );
  ok('1질문 백스톱: 3개 감지 → 되돌림 버튼 → 재질문');
}

/* ── 8. 레버 3 — 카드 생성 → 인출 → SRS ── */
$('#makeCardsBtn').click();
await new Promise((r) => setTimeout(r, 250));
assert.ok($('#view-recall').classList.contains('active'), '인출 탭 자동 이동 실패');
assert.equal($('#duePill').hidden, false, 'due 뱃지 미표시');
assert.equal($('#duePill').textContent, '2');

const cardEl = $('#recallArea .card');
assert.ok(cardEl, '카드 미렌더');
assert.ok(!cardEl.textContent.includes('각 매크로태스크 사이에 완전히'), '⚠ 답을 미리 보여줌!');
cardEl.querySelector('textarea').value = '매 매크로태스크 사이에 비워져요';
[...cardEl.querySelectorAll('button')].find((b) => b.textContent === '채점').click();
await new Promise((r) => setTimeout(r, 250));

const out = cardEl.querySelector('.grade-out');
assert.ok(out, '채점 결과 미표시');
assert.ok(out.textContent.includes('4 / 5'));
assert.ok(out.querySelector('.reveal').textContent.includes('각 매크로태스크'), '채점 후 모범답안 미공개');
assert.ok(out.textContent.includes('다음 복습'), 'SRS 다음 일정 미표시');
ok('레버3: 카드 생성 → 답 제출 전 정답 은닉 → 채점 → SRS 재예약');

/* ── 9. 레버 4 — 자기설명 ── */
window.document.querySelector('.tab[data-view="explain"]').click();
await tick();
$('#exTopic').value = 'Node 이벤트 루프';
$('#exText').value = '이벤트 루프는 매 매크로태스크가 끝날 때마다 마이크로태스크 큐를 완전히 비운다. 그래서 Promise 콜백이 setTimeout보다 먼저 실행된다. 이게 순서 차이의 이유다.';
$('#exText').dispatchEvent(new window.Event('input'));
$('#exGradeBtn').click();
await new Promise((r) => setTimeout(r, 250));

const res = $('#exResult');
assert.ok(res.querySelector('.score').textContent === '72', '점수 미표시');
assert.equal(res.querySelectorAll('.finding').length, 2);
assert.ok(res.querySelector('.finding.error, .finding.gap'), '문제 항목 미표시');
assert.ok(res.textContent.includes('왜 먼저일까요?'), 'fix가 질문 형태로 미표시');
assert.ok($('#exHistory').textContent.includes('72점'), '히스토리 미갱신');

await assert.rejects(() => api.explain.grade({ topic: 't', explanation: '짧음' }), /60자/);
ok('레버4: 진단 렌더 + 짧은 설명 차단');

/* ── 10. 대시보드 + 안티패턴 ── */
window.document.querySelector('.tab[data-view="dash"]').click();
await tick();
assert.equal($('#kpis').children.length, 5, 'KPI 5개가 아님');
assert.equal($('#spark').children.length, 14, '스파크라인 14일이 아님');
assert.ok($('#flags').children.length >= 1, '안티패턴 플래그 없음');
assert.ok($('#conceptTable').querySelector('table'), '개념 테이블 없음');
$('#coachBtn').click();
await new Promise((r) => setTimeout(r, 200));
assert.ok($('#coach').textContent.includes('정답 보기'), '코치 응답 미표시');
ok('대시보드: KPI·스파크라인·안티패턴·개념표·코치');

/* ── 11. 설정 + 연결 확인 ── */
$('#settingsBtn').click();
await tick();
assert.equal($('#settingsModal').hidden, false);
$('#healthBtn').click();
await new Promise((r) => setTimeout(r, 150));
assert.ok($('#healthOut').textContent.includes('연결됨'), 'health check 실패');
$('#setModel').value = 'opus';
$('#setSave').click();
await tick();
assert.equal((await api.settings.get()).model, 'opus', '설정 저장 실패');
ok('설정 저장 + 연결 확인');

/* ── 11a. Obsidian: 보관함 선택 → 수동 저장 → 자동 저장 ── */
{
  // 보관함 미설정 상태에서는 명확히 막혀야 한다
  await assert.rejects(() => api.obsidian.export('nope'), /찾을 수 없어요/);

  const vault = path.join(USERDATA, 'vault');
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  electron.__test.state.pickResult = { canceled: false, filePaths: [vault] };

  $('#settingsBtn').click();
  await tick();
  $('#obsPickBtn').click();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await api.settings.get()).obsidianVault, vault, '보관함 저장 실패');
  assert.ok($('#obsInfo').textContent.includes(vault), '보관함 경로 미표시');

  $('#obsFolder').value = 'LWC';
  $('#obsAuto').checked = true;
  $('#obsCards').checked = true;
  $('#setSave').click();
  await tick();

  // 자동 저장: 진단 직후 노트가 이미 만들어져 있어야 한다
  window.document.querySelector('.tab[data-view="explain"]').click();
  await tick();
  $('#exTopic').value = 'Node 이벤트 루프';
  $('#exText').value = '이벤트 루프는 매 매크로태스크가 끝날 때마다 마이크로태스크 큐를 완전히 비운다. 그래서 Promise 콜백이 setTimeout보다 먼저 실행된다.';
  $('#exText').dispatchEvent(new window.Event('input'));
  $('#exGradeBtn').click();
  await new Promise((r) => setTimeout(r, 300));

  const banner = $('#exResult .exported');
  assert.ok(banner, '자동 저장 배너가 안 뜸');
  assert.ok(banner.textContent.includes('개념'), '개념 연결 수 미표시');

  const notesDir = path.join(vault, 'LWC', '노트');
  const files = fs.readdirSync(notesDir);
  assert.equal(files.length, 1, `노트 1개여야 하는데 ${files.length}개`);
  const note = fs.readFileSync(path.join(notesDir, files[0]), 'utf8');
  assert.ok(note.includes('마이크로태스크 큐를 완전히 비운다'), '자기설명 본문 누락');
  assert.ok(note.includes('#flashcards/'), '카드 미포함');
  assert.ok(note.includes('[[개념/microtask|microtask]]'), '개념 링크 없음');
  assert.ok(fs.existsSync(path.join(vault, 'LWC', '개념', 'microtask.md')), '개념 허브 미생성');

  // Finder 열기
  banner.querySelector('button').click();
  await tick();
  assert.ok(electron.__test.state.revealed?.endsWith('.md'), 'Finder 열기 실패');
  ok('Obsidian: 보관함 선택 → 자동 저장 → 노트·카드·개념 허브 생성');
}

/* ── 11b. 데이터 보관 UI ── */
{
  assert.equal(electron.__test.state.appName, 'Learn with Claude', 'app.setName 미호출 — userData 경로가 흔들릴 수 있음');

  const info = $('#dataInfo').textContent;
  assert.ok(info.includes('세션 1'), `데이터 요약 미표시: ${info}`);
  assert.ok(info.includes('지워지지 않아요'), '보관 위치 안내 없음');

  $('#backupBtn').click();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok((await api.data.info()).backups.length >= 1, '수동 백업 실패');

  $('#revealBtn').click();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(electron.__test.state.revealed?.endsWith('data.json'), 'Finder 열기 실패');
  ok('데이터 보관: 앱 이름 고정 · 요약 표시 · 수동 백업 · Finder 열기');
}

/* ── 12. 영속성 ── */
const raw = JSON.parse(fs.readFileSync(path.join(USERDATA, 'data.json'), 'utf8'));
assert.equal(raw.sessions.length, 1);
assert.equal(raw.cards.length, 2);
assert.equal(raw.explains.length, 2); // 레버4 테스트 + Obsidian 자동 저장 테스트
assert.ok(raw.events.length >= 5);
assert.ok(raw.events.some((e) => e.type === 'obsidian_export'), '내보내기 이벤트 미기록');
assert.equal(raw.sessions[0].maxHintLevel, 3, 'L3 도달 기록 안 됨');
assert.equal(raw.settings.obsidianFolder, 'LWC', 'Obsidian 설정 미영속');
ok(`영속성: 세션1 · 카드2 · 설명2 · 이벤트${raw.events.length}`);

/* ── 12b. 오래된 메인 프로세스 (Cmd+R 후 IPC 채널 누락) ──
   Cmd+R 은 렌더러만 새로고침하므로 메인은 예전 코드로 남는다.
   그때 채널 하나가 없다고 부팅 전체가 멈추면 안 된다. */
{
  const dom2 = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w2 = dom2.window;
  const errs2 = [];
  w2.addEventListener('error', (e) => errs2.push(String(e.error ?? e.message)));
  w2.addEventListener('unhandledrejection', (e) => errs2.push(String(e.reason)));
  w2.confirm = () => true;
  w2.api = {
    ...api,
    narrowRequest: async () => {
      throw new Error("Error invoking remote method 'meta:narrowRequest': Error: No handler registered for 'meta:narrowRequest'");
    },
  };
  w2.eval(appJs);
  await new Promise((r) => setTimeout(r, 250));

  assert.deepEqual(errs2, [], '누락된 IPC 채널이 부팅을 깨뜨림');
  assert.ok(
    dom2.window.document.querySelector('#sessionList').children.length >= 1,
    '한 단계 실패 후 나머지 부팅이 중단됨',
  );
  const t2 = dom2.window.document.querySelector('#toast');
  assert.equal(t2.hidden, false, '재시작 안내가 뜨지 않음');
  assert.ok(t2.textContent.includes('Cmd+Q'), `안내 문구 부적절: ${t2.textContent}`);
  ok('오래된 메인 프로세스: 부팅 계속 진행 + 재시작 안내');
}

/* ── 13. 에러 경로 ── */
assert.deepEqual(errors, [], `렌더러 누적 에러: ${errors.join('; ')}`);
await assert.rejects(() => api.session.send({ sessionId: 'nope', text: 'x' }), /찾을 수 없어요/);
await assert.rejects(() => api.cards.answer({ cardId: 'nope', answer: 'x' }), /찾을 수 없어요/);
ok('에러 경로 정상 · 렌더러 에러 0건');

console.log(pass.map((p, i) => `  ${String(i + 1).padStart(2)}. ✓ ${p}`).join('\n'));
console.log(`\n${pass.length}/${pass.length} PASS`);
process.exit(0); // main.js의 복습 알림 setInterval이 프로세스를 붙잡고 있음
