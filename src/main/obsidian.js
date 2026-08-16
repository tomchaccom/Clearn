/**
 * Obsidian 보관함 내보내기.
 *
 * 설계 원칙 — 노트의 소유권은 학습자에게 남긴다.
 *   본문 = 학습자가 '설명' 탭에 직접 쓴 자기설명 (한 글자도 고치지 않는다)
 *   Claude 의 진단은 callout 인용 블록으로 명확히 분리한다
 *   Claude 가 매끈하게 정리한 요약은 만들지 않는다 (그게 인지적 외주화니까)
 *
 * 지식 그래프는 개념 허브 노트 + 양방향 wikilink 로 만든다.
 * 같은 개념을 다시 학습하면 허브에 자동으로 모여서 인출 실패 패턴이 눈에 보인다.
 *
 * 재내보내기 안전성:
 *   관리 영역을 마커로 감싸고, 그 바깥에 학습자가 덧붙인 내용은 절대 건드리지 않는다.
 */

import fs from 'node:fs';
import path from 'node:path';

const BEGIN = '<!-- learn-with-claude:begin -->';
const END = '<!-- learn-with-claude:end -->';

const NOTES_DIR = '노트';
const CONCEPTS_DIR = '개념';

/* ─────────────────────────── 유틸 ─────────────────────────── */

/** Obsidian/macOS 에서 파일명에 못 쓰는 문자 정리. */
export function safeName(s, fallback = 'untitled') {
  const cleaned = String(s ?? '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

const ymd = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** YAML 값 이스케이프 — 콜론·따옴표가 들어가도 깨지지 않게. */
const yv = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function frontmatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${k}: [${v.map((x) => yv(x)).join(', ')}]`);
    } else if (typeof v === 'number') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${yv(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * 프론트매터는 통째로 갱신하고, 관리 영역만 교체한다.
 * 마커 바깥의 학습자 메모는 그대로 보존된다.
 */
export function mergeNote(existing, fm, managed) {
  const block = `${BEGIN}\n${managed}\n${END}`;
  if (!existing) return `${fm}\n\n${block}\n`;

  // 기존 프론트매터 제거
  let rest = existing.startsWith('---') ? existing.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : existing;

  const i = rest.indexOf(BEGIN);
  const j = rest.indexOf(END);
  if (i !== -1 && j !== -1 && j > i) {
    rest = rest.slice(0, i) + block + rest.slice(j + END.length);
  } else {
    rest = `${block}\n\n${rest.trimStart()}`;
  }
  return `${fm}\n\n${rest.trim()}\n`;
}

function writeNote(file, fm, managed) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const next = mergeNote(existing, fm, managed);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  return { file, created: !existing };
}

/* ─────────────────────────── 보관함 ─────────────────────────── */

/** 보관함 경로가 쓸 만한지 확인. .obsidian 이 없어도 막지는 않는다. */
export function checkVault(vaultPath) {
  if (!vaultPath) return { ok: false, reason: '보관함 경로가 설정되지 않았어요.' };
  if (!fs.existsSync(vaultPath)) return { ok: false, reason: '경로가 존재하지 않아요.' };
  if (!fs.statSync(vaultPath).isDirectory()) return { ok: false, reason: '폴더가 아니에요.' };
  try {
    fs.accessSync(vaultPath, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: '쓰기 권한이 없어요.' };
  }
  const isVault = fs.existsSync(path.join(vaultPath, '.obsidian'));
  return {
    ok: true,
    isVault,
    warning: isVault ? null : '.obsidian 폴더가 없어요. Obsidian 보관함이 맞는지 확인해 주세요.',
  };
}

/* ─────────────────────────── 본문 생성 ─────────────────────────── */

const CALLOUT = { error: 'danger', gap: 'warning', vague: 'question', correct: 'success' };
const KIND_KO = { error: '오류', gap: '누락', vague: '뭉갬', correct: '정확' };

function findingsBlock(findings = []) {
  const order = { error: 0, gap: 1, vague: 2, correct: 3 };
  const sorted = [...findings].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  const out = [];
  for (const f of sorted) {
    const lines = [`> [!${CALLOUT[f.kind] ?? 'note'}] ${KIND_KO[f.kind] ?? f.kind}`];
    if (f.quote) lines.push(`> > ${f.quote}`, '>');
    if (f.note) lines.push(`> ${f.note}`);
    if (f.fix && f.kind !== 'correct') lines.push(`>`, `> **${f.fix}**`);
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

/** Obsidian spaced-repetition 플러그인의 multi-line 포맷. 답에 빈 줄이 있으면 카드가 잘린다. */
function cardsBlock(cards, topic) {
  if (!cards.length) return '';
  const deck = safeName(topic).replace(/\s+/g, '-');
  const body = cards
    .map((c) => {
      const back = String(c.back).replace(/\n{2,}/g, '\n').trim();
      return `${String(c.front).trim()}\n?\n${back}`;
    })
    .join('\n\n');
  return `#flashcards/${deck}\n\n${body}`;
}

/**
 * 세션 노트 한 장 + 개념 허브 노트들을 쓴다.
 *
 * @param {object} p
 * @param {string} p.vaultPath
 * @param {string} p.rootFolder
 * @param {object|null} p.session
 * @param {object} p.explain     자기설명 기록 (본문의 주인공)
 * @param {Array}  p.cards
 * @param {boolean} p.exportCards
 * @param {(concept:string)=>{total:number,ok:number}|null} p.conceptStat
 */
export function exportExplain({ vaultPath, rootFolder, session, explain, cards = [], exportCards = true, conceptStat }) {
  const check = checkVault(vaultPath);
  if (!check.ok) throw new Error(`Obsidian 보관함: ${check.reason}`);

  const root = path.join(vaultPath, safeName(rootFolder || 'Learn with Claude'));
  const topic = explain.topic || session?.topic || '무제';
  const date = ymd(explain.createdAt);
  const noteName = safeName(`${date} ${topic}`);
  const noteFile = path.join(root, NOTES_DIR, `${noteName}.md`);

  const concepts = [...new Set([...(explain.concepts ?? []), ...cards.map((c) => c.concept)].filter(Boolean))].map(
    (c) => safeName(c),
  );

  /* ── 세션 노트 ── */
  const fm = frontmatter({
    created: date,
    source: 'learn-with-claude',
    topic,
    'self-explanation-score': explain.score,
    'hint-level-reached': session ? `L${session.maxHintLevel}` : undefined,
    concepts,
    tags: ['learning'],
  });

  const parts = [`# ${topic}`];

  if (session?.question) parts.push(`## 배우려던 것\n\n${session.question}`);

  if (session?.hypothesis)
    parts.push(
      `## 처음 가설\n\n> [!abstract] 학습 전\n> ${session.hypothesis.split('\n').join('\n> ')}`,
    );

  // ★ 본문 — 학습자가 직접 쓴 글. 손대지 않는다.
  parts.push(`## 내 말로 설명\n\n${explain.text.trim()}`);

  if (explain.verdict || explain.findings?.length) {
    const diag = [`## Claude 진단 (${explain.score}점)`, ''];
    if (explain.verdict) diag.push(`${explain.verdict}`, '');
    const fb = findingsBlock(explain.findings);
    if (fb) diag.push(fb);
    parts.push(diag.join('\n').trimEnd());
  }

  if (exportCards && cards.length) parts.push(`## 인출 카드\n\n${cardsBlock(cards, topic)}`);

  if (concepts.length)
    parts.push(`## 개념\n\n${concepts.map((c) => `- [[${CONCEPTS_DIR}/${c}|${c}]]`).join('\n')}`);

  const note = writeNote(noteFile, fm, parts.join('\n\n'));

  /* ── 개념 허브 노트 (지식 그래프의 결절점) ── */
  const conceptFiles = [];
  for (const c of concepts) {
    const file = path.join(root, CONCEPTS_DIR, `${c}.md`);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

    // 이 허브에 이미 걸려 있는 학습 노트 링크를 모아 중복 없이 유지한다
    const links = new Set(
      [...existing.matchAll(/^- \[\[노트\/(.+?)\|/gm)].map((m) => m[1]),
    );
    links.add(noteName);

    const stat = conceptStat?.(c);
    const rate = stat && stat.total ? Math.round((stat.ok / stat.total) * 100) : null;

    const managed = [
      `# ${c}`,
      '',
      '## 이 개념을 다룬 학습',
      '',
      [...links]
        .sort()
        .reverse()
        .map((n) => `- [[${NOTES_DIR}/${n}|${n}]]`)
        .join('\n'),
      '',
      '## 인출 성적',
      '',
      rate === null ? '아직 인출 기록이 없어요.' : `${stat.ok} / ${stat.total} (${rate}%)`,
      rate !== null && rate < 60 ? '\n> [!warning] 약한 개념\n> 인출 성공률이 60% 아래예요.' : '',
    ]
      .join('\n')
      .trimEnd();

    const cfm = frontmatter({ type: 'concept', source: 'learn-with-claude', tags: ['learning/concept'] });
    conceptFiles.push(writeNote(file, cfm, managed).file);
  }

  return {
    note: note.file,
    created: note.created,
    concepts: conceptFiles,
    cardCount: exportCards ? cards.length : 0,
  };
}

/**
 * 개발자 친화 개념 노트를 Obsidian 파일에 작성/업데이트.
 * 기존 ## 선수 개념 섹션(DAG 링크)은 보존.
 */
/**
 * 대화 세션을 Obsidian 노트로 내보낸다.
 * 자기설명(explainExport)과 달리 질문·가설·대화 전체를 저장한다.
 */
export function exportSession({ vaultPath, rootFolder, session }) {
  const check = checkVault(vaultPath);
  if (!check.ok) throw new Error(`Obsidian 보관함: ${check.reason}`);

  const root = path.join(vaultPath, safeName(rootFolder || 'Learn with Claude'));
  const date = ymd(session.createdAt);
  const noteName = safeName(`${date} ${session.topic}`);
  const noteFile = path.join(root, NOTES_DIR, `${noteName}.md`);

  const fm = frontmatter({
    created: date,
    source: 'learn-with-claude',
    topic: session.topic,
    type: 'session',
    'hint-level': `L${session.maxHintLevel ?? 0}`,
    tags: ['learning'],
  });

  const parts = [`# ${session.topic}`];
  if (session.question) parts.push(`## 질문\n\n${session.question}`);
  if (session.hypothesis)
    parts.push(`## 처음 가설\n\n> [!abstract] 학습 전\n> ${session.hypothesis.split('\n').join('\n> ')}`);

  if (session.messages?.length) {
    parts.push('## 대화');
    for (const msg of session.messages) {
      const who = msg.role === 'user' ? '**나**' : '**Claude**';
      const hint = msg.hintLevel !== undefined ? ` *(L${msg.hintLevel})*` : '';
      parts.push(`${who}${hint}\n\n${msg.text}`);
    }
  }

  const note = writeNote(noteFile, fm, parts.join('\n\n'));
  return { note: note.file, created: note.created };
}

/**
 * 보관함 내 모든 .md 파일의 제목을 수집한다 (DAG 분석용).
 * 노트 폴더 + 개념 폴더 + 루트 폴더를 스캔한다.
 */
export function scanVaultTopics(vaultPath, rootFolder) {
  const root = path.join(vaultPath, safeName(rootFolder || 'Learn with Claude'));
  const titles = new Set();
  const dirs = [path.join(root, NOTES_DIR), path.join(root, CONCEPTS_DIR), root];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(path.join(dir, f), 'utf8');
        const h1 = content.match(/^#\s+(.+)/m)?.[1]?.trim();
        titles.add(h1 || f.slice(0, -3));
      } catch { titles.add(f.slice(0, -3)); }
    }
  }
  return [...titles];
}

export function writeConceptNote(vaultPath, folderName, concept, noteContent) {
  const conceptsDir = path.join(vaultPath, safeName(folderName || 'Learn with Claude'), '개념');
  if (!fs.existsSync(conceptsDir)) fs.mkdirSync(conceptsDir, { recursive: true });

  const filePath = path.join(conceptsDir, `${safeName(concept)}.md`);
  const MARKER_BEGIN = '<!-- CLEARN:BEGIN -->';
  const MARKER_END = '<!-- CLEARN:END -->';

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const dagIdx = existing.indexOf('## 선수 개념');
  const dagSection = dagIdx >= 0 ? '\n\n' + existing.slice(dagIdx) : '';

  const frontmatter = `---\nconcept: "${concept}"\nupdated: "${new Date().toISOString().slice(0, 10)}"\ntags: [clearn, concept]\n---\n\n`;
  const newContent = frontmatter + MARKER_BEGIN + '\n' + noteContent.trim() + '\n' + MARKER_END + dagSection;

  fs.writeFileSync(filePath, newContent, 'utf8');
  return filePath;
}
