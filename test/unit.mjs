/** 순수 로직 단위 테스트: 저장소 · SM-2 스케줄러 · JSON 파서 · 프롬프트. 실행: npm test */
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import * as store from '../src/main/store.js';
import { extractJson } from '../src/main/agent.js';
import { tutorSystemPrompt, tutorTurnSuffix, HINT_LADDER, countQuestions } from '../src/main/prompts.js';

const pass = [];
const ok = (m) => pass.push(m);

store.init(path.join(process.env.TEST_USERDATA, 'unit'));

/* 세션 */
const s = store.createSession({
  topic: '이벤트 루프',
  question: '왜 microtask가 먼저?',
  hypothesis: '마이크로태스크 큐가 매 틱마다 완전히 비워지기 때문이라고 생각해요',
});
store.addMessage(s.id, { role: 'user', text: '가설' });
store.addMessage(s.id, { role: 'assistant', text: '그럼 setTimeout 0은?' });
store.updateSession(s.id, { hintLevel: 2 });
store.updateSession(s.id, { hintLevel: 0 });
assert.equal(store.getSession(s.id).maxHintLevel, 2, 'maxHintLevel은 내려가면 안 됨');
assert.ok(store.transcript(s.id).includes('튜터:'));
ok('세션 CRUD · maxHintLevel 단조 증가 · 트랜스크립트');

/* SM-2 */
const cards = store.addCards(s.id, '이벤트 루프', [
  { front: 'q1', back: 'a1', concept: 'microtask', kind: 'core' },
  { front: 'q2', back: 'a2', concept: 'microtask', kind: 'transfer' },
  { bad: 1 }, // 불량 데이터는 걸러져야 함
]);
assert.equal(cards.length, 2, '불량 카드가 통과됨');
assert.equal(store.dueCards().length, 2, '신규 카드는 즉시 due여야 함');

let c = store.gradeCard(cards[0].id, 4);
assert.equal(c.interval, 1);
c = store.gradeCard(cards[0].id, 4);
assert.equal(c.interval, 3);
c = store.gradeCard(cards[0].id, 5);
assert.ok(c.interval > 3 && c.ease > 2.5, '연속 성공 시 간격·ease 증가');
c = store.gradeCard(cards[0].id, 1);
assert.equal(c.reps, 0, '실패 시 reps 리셋');
assert.equal(c.lapses, 1);
assert.ok(c.due - Date.now() <= 11 * 60 * 1000, '실패 카드는 오늘 다시 나와야 함');
assert.ok(c.ease >= 1.3, 'ease 하한');
store.gradeCard(cards[1].id, 0);
ok('SM-2: 1→3→확장, 실패 시 리셋·10분 후 재등장·ease 하한');

/* 통계 + 안티패턴 */
store.addExplain({ sessionId: s.id, topic: '이벤트 루프', text: 'x', score: 90, verdict: 'v', findings: [], concepts: ['microtask'] });
const st = store.stats();
assert.equal(st.recallRate, 60);
assert.equal(st.explainAvg, 90);
assert.equal(Object.keys(st.daily).length, 14);
assert.equal(st.concepts[0].concept, 'microtask');
const flags = store.antipatterns();
assert.ok(flags.some((f) => f.title.includes('유능감의 착각')), '자기설명90 vs 인출60 → 착각 플래그가 떠야 함');
ok('통계 집계 + 유능감의 착각 감지');

/* JSON 파서 */
assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
assert.deepEqual(extractJson('여기요: [{"b":"}"},2] 끝'), [{ b: '}' }, 2]);
assert.deepEqual(extractJson('{"s":"he said \\"hi\\" {"}'), { s: 'he said "hi" {' });
assert.equal(extractJson('no json here'), undefined);
assert.equal(extractJson(''), undefined);
ok('JSON 파서: 펜스·전후 잡담·문자열 내 괄호/이스케이프');

/* 프롬프트 가드레일 */
const sys = tutorSystemPrompt({ topic: 't', learnerLevel: 'l' });
assert.ok(sys.includes('HINT_LEVEL'));
assert.ok(/완성된 답이나 전체 코드를 먼저 주지 마세요/.test(sys));
assert.equal(HINT_LADDER.length, 4);
assert.ok(tutorTurnSuffix(0).includes('힌트를 절대 주지 마세요'));
assert.ok(tutorTurnSuffix(3).includes('정답 보기'));
assert.ok(tutorTurnSuffix(99).includes('정답 보기'), '범위 밖 값은 클램프되어야 함');
ok('프롬프트 가드레일 + 힌트 사다리 클램프');

/* "한 턴에 질문 하나" 규칙 — 프롬프트 일관성 + 카운터 */
assert.ok(/물음표는 정확히 1개/.test(sys), '시스템 프롬프트에 1질문 규칙 없음');
for (const [i, r] of HINT_LADDER.slice(0, 3).entries())
  assert.ok(
    /딱 하나/.test(r.directive),
    `L${i} 지시문이 질문 개수를 제한하지 않음 — 시스템 프롬프트와 모순되면 모델은 구체적인 쪽을 따름`,
  );
assert.ok(!/1~3개|2~3개|여러 개 던/.test(JSON.stringify(HINT_LADDER)), '복수 질문을 허용하는 문구가 남아 있음');

assert.equal(countQuestions('왜 그럴까요?'), 1);
assert.equal(countQuestions('A는요? 그리고 B는요? C는?'), 3);
assert.equal(countQuestions('설명해 볼게요.'), 0);
assert.equal(countQuestions('```cpp\nint m = a > b ? a : b;\n```\n어떻게 될까요?'), 1, '코드블록 삼항연산자 오탐');
assert.equal(countQuestions('`x ? y : z` 를 보세요.'), 0, '인라인 코드 오탐');
assert.equal(countQuestions('맞나요？ 틀린가요？'), 2, '전각 물음표 미인식');
assert.equal(countQuestions(''), 0);
ok('1질문 규칙: 프롬프트 일관성 + 카운터(삼항연산자·전각 물음표)');

store.flush();

/* ─────────── 내구성: 업데이트·크래시를 넘겨 데이터가 살아남는가 ─────────── */

const freshDir = (n) => {
  const d = path.join(process.env.TEST_USERDATA, n);
  fs.rmSync(d, { recursive: true, force: true });
  return d;
};
const seed = () => {
  store.createSession({ topic: 'T', question: 'Q', hypothesis: '0'.repeat(30) });
  store.addCards('x', 'T', [{ front: 'f', back: 'b', concept: 'c' }]);
  store.flush();
};

/* 원자적 쓰기 — 반쯤 쓰인 tmp 파일이 남으면 안 됨 */
{
  const dir = freshDir('durab-atomic');
  store.init(dir);
  seed();
  assert.ok(fs.existsSync(path.join(dir, 'data.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'data.json.tmp')), 'tmp 파일이 남음');
  assert.equal(store.dataInfo().version, store.SCHEMA_VERSION);
  ok('원자적 쓰기 (tmp → rename, 잔여물 없음)');
}

/* 손상 복구 — 깨진 파일은 격리하고 백업에서 되살림 */
{
  const dir = freshDir('durab-corrupt');
  store.init(dir);
  seed();
  const backup = store.backupNow('test');
  assert.ok(backup, '백업 생성 실패');

  fs.writeFileSync(path.join(dir, 'data.json'), '{"sessions": [[[ 잘린 파일');
  store.init(dir); // 재부팅

  const info = store.dataInfo();
  assert.equal(info.counts.sessions, 1, '백업에서 세션이 복구되지 않음');
  assert.equal(info.counts.cards, 1, '백업에서 카드가 복구되지 않음');
  assert.ok(info.notes.some((n) => n.includes('격리')), '손상 격리 안내 없음');
  assert.ok(info.notes.some((n) => n.includes('복구')), '복구 안내 없음');
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.corrupt-')), '깨진 파일을 보존하지 않음');
  ok('손상 복구: 격리 + 최신 백업에서 자동 복원');
}

/* 다운그레이드 — 더 새 버전이 쓴 파일을 훼손하지 않음 */
{
  const dir = freshDir('durab-downgrade');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'data.json'),
    JSON.stringify({ version: 99, sessions: [], cards: [], explains: [], events: [], settings: {}, futureField: '보존' }),
  );
  store.init(dir);
  const info = store.dataInfo();
  assert.equal(info.version, 99, '버전을 임의로 되돌림');
  assert.ok(info.notes.some((n) => n.includes('새로운 형식')), '다운그레이드 안내 없음');
  assert.ok(info.backups.some((b) => b.includes('downgrade')), '다운그레이드 백업 없음');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).futureField, '보존', '미래 필드가 삭제됨');
  ok('다운그레이드 안전: 미지 필드 보존 + 백업');
}

/* 백업 정리 — 무한 증식 방지 */
{
  const dir = freshDir('durab-prune');
  store.init(dir);
  seed();
  for (let i = 0; i < 15; i++) store.backupNow(`n${String(i).padStart(2, '0')}`);
  const n = store.dataInfo().backups.length;
  assert.ok(n <= 10, `백업이 ${n}개 남음 (10개 이하여야 함)`);
  ok(`백업 로테이션 (${n}개 유지)`);
}

/* ─────────── Obsidian 내보내기 ─────────── */

const obs = await import('../src/main/obsidian.js');

{
  const vault = freshDir('vault');
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });

  assert.equal(obs.checkVault(vault).ok, true);
  assert.equal(obs.checkVault(path.join(vault, '없음')).ok, false);
  assert.equal(obs.safeName('a/b:c*d?e"f<g>h|i#j^k[l]m'), 'a b c d e f g h i j k l m');
  assert.equal(obs.safeName('   '), 'untitled');

  const session = {
    topic: 'Node 이벤트 루프',
    question: '왜 microtask가 먼저?',
    hypothesis: '큐가 매 틱마다 비워지기 때문',
    maxHintLevel: 2,
  };
  const explain = {
    id: 'e1',
    createdAt: Date.UTC(2026, 7, 2, 3),
    topic: 'Node 이벤트 루프',
    text: '내가 쓴 설명이에요.\n두 번째 줄.',
    score: 72,
    verdict: '방향은 맞아요.',
    findings: [
      { kind: 'gap', quote: '큐', note: '우선순위 근거 누락', fix: '왜 먼저일까요?' },
      { kind: 'correct', quote: '', note: '정확해요', fix: '' },
    ],
    concepts: ['microtask', 'Event Loop: 심화'],
  };
  const cards = [{ front: 'Q1', back: 'A1\n\nA1-2', concept: 'microtask', kind: 'core' }];

  const r = obs.exportExplain({
    vaultPath: vault,
    rootFolder: 'Learn with Claude',
    session,
    explain,
    cards,
    exportCards: true,
    conceptStat: (c) => (c === 'microtask' ? { total: 5, ok: 2 } : null),
  });

  const note = fs.readFileSync(r.note, 'utf8');

  // 소유권: 본문은 학습자의 글 그대로
  assert.ok(note.includes('## 내 말로 설명\n\n내가 쓴 설명이에요.\n두 번째 줄.'), '자기설명 본문 누락/변형');
  assert.ok(note.includes('## 처음 가설'), '가설 미기록');
  assert.ok(note.indexOf('## 내 말로 설명') < note.indexOf('## Claude 진단'), '진단이 본문보다 앞섬');
  assert.ok(note.includes('> [!warning] 누락'), 'callout 미생성');
  assert.ok(note.includes('> **왜 먼저일까요?**'), 'fix 질문 누락');

  // 프론트매터
  assert.ok(note.startsWith('---\n'), '프론트매터 없음');
  assert.ok(note.includes('self-explanation-score: 72'));
  assert.ok(note.includes('hint-level-reached: "L2"'));
  assert.ok(note.includes('created: "2026-08-02"'), '날짜 오류');

  // 카드 (spaced-repetition multi-line) — 답의 빈 줄이 제거돼야 카드가 안 잘림
  assert.ok(note.includes('#flashcards/Node-이벤트-루프'), '덱 태그 없음');
  assert.ok(note.includes('Q1\n?\nA1\nA1-2'), '카드 포맷 오류');

  // 지식 그래프
  assert.equal(r.concepts.length, 2);
  assert.ok(note.includes('[[개념/microtask|microtask]]'), '개념 링크 없음');
  const hub = fs.readFileSync(r.concepts[0], 'utf8');
  assert.ok(hub.includes('[[노트/2026-08-02 Node 이벤트 루프|'), '허브 → 노트 역링크 없음');
  assert.ok(hub.includes('2 / 5 (40%)'), '인출 성적 미표시');
  assert.ok(hub.includes('약한 개념'), '60% 미만 경고 없음');
  // 콜론이 들어간 개념명도 파일로 만들어져야 함
  assert.ok(fs.existsSync(path.join(vault, 'Learn with Claude', '개념', 'Event Loop 심화.md')));
  ok('Obsidian: 자기설명 본문 · 진단 callout · 카드 · 개념 허브 양방향 링크');
}

/* 재내보내기 — 사용자가 덧붙인 내용을 보존하는가 */
{
  const vault = freshDir('vault2');
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  const base = {
    vaultPath: vault,
    rootFolder: 'LWC',
    session: null,
    explain: { id: 'e', createdAt: Date.now(), topic: '재내보내기', text: '첫 설명이에요.', score: 50, verdict: 'v', findings: [], concepts: ['C'] },
    cards: [],
    exportCards: false,
    conceptStat: () => null,
  };

  const r1 = obs.exportExplain(base);
  assert.equal(r1.created, true);

  // 학습자가 노트 아래에 직접 메모를 덧붙였다
  fs.appendFileSync(r1.note, '\n## 내가 나중에 덧붙인 메모\n지우면 안 돼요.\n');

  const r2 = obs.exportExplain({ ...base, explain: { ...base.explain, text: '고친 설명이에요.', score: 88 } });
  assert.equal(r2.created, false, '같은 파일에 써야 함');
  const after = fs.readFileSync(r2.note, 'utf8');
  assert.ok(after.includes('지우면 안 돼요.'), '⚠ 사용자가 덧붙인 내용이 삭제됨');
  assert.ok(after.includes('고친 설명이에요.'), '관리 영역이 갱신 안 됨');
  assert.ok(!after.includes('첫 설명이에요.'), '옛 내용이 남음');
  assert.equal((after.match(/^---$/gm) ?? []).length, 2, '프론트매터가 중복됨');
  assert.ok(after.includes('self-explanation-score: 88'), '프론트매터 미갱신');

  // 허브 노트는 여러 세션 링크를 누적해야 한다
  obs.exportExplain({ ...base, explain: { ...base.explain, id: 'e2', createdAt: Date.now() + 86400000, topic: '두번째' } });
  const hub = fs.readFileSync(path.join(vault, 'LWC', '개념', 'C.md'), 'utf8');
  assert.equal((hub.match(/^- \[\[노트\//gm) ?? []).length, 2, '허브에 링크가 누적되지 않음');
  ok('재내보내기: 사용자 추가분 보존 · 프론트매터 갱신 · 허브 링크 누적');
}

console.log(pass.map((p, i) => `  ${String(i + 1).padStart(2)}. ✓ ${p}`).join('\n'));
console.log(`\n[unit] ${pass.length}/${pass.length} PASS\n`);
