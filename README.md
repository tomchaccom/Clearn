# Clearn

소크라테스식 AI 튜터 · 인출 연습(SM-2) · 자기설명 검증 · 에빙하우스 망각 곡선 기반 복습.
Claude Code 구독으로 동작하는 macOS 학습 앱 (API 키 불필요).

핵심 설계 원칙: 답을 늦게 받고, 내 머리를 먼저 쓰게 만든다. 이 앱은 편의를 위해 만든 게 아니라 **불편함을 유지하기 위해** 만들었다.

---

## 스크린샷

> UI 스크린샷은 `docs/screenshots/` 폴더에 추가하세요.

| 탐구 (소크라테스 대화) | 인출 카드 (플래시카드) | 대시보드 |
|---|---|---|
| _(스크린샷 추가 예정)_ | _(스크린샷 추가 예정)_ | _(스크린샷 추가 예정)_ |

---

## 설치 및 실행

### 요구사항
- macOS 12+
- [Claude Code](https://claude.ai/code) 설치 및 로그인 (`claude` 명령 사용 가능 상태)

```bash
git clone https://github.com/tomchaccom/Clearn.git
cd Clearn
npm install
npm start
```

앱 번들(.dmg) 빌드:
```bash
npm run dist    # dist/ 에 생성
```

### 코드를 고쳤을 때

| 고친 파일 | 반영 방법 |
|---|---|
| `src/renderer/**` (HTML · CSS · app.js) | `Cmd+R` 새로고침 |
| `src/main/**` · `preload.cjs` | **`Cmd+Q` 후 `npm start`** — `Cmd+R` 로는 반영 안 됨 |

메인 프로세스만 옛날 코드로 남으면 IPC 채널이 없어 에러가 난다.
그 경우 앱이 죽지 않고 나머지는 정상 부팅하면서 재시작 안내를 띄운다.

앱 번들(.dmg)로 만들려면:

```bash
npm run dist        # dist/ 에 생성
```

### 인증

Claude Agent SDK가 로컬 **Claude Code 로그인(구독)** 을 그대로 사용한다. 별도 API 키 불필요.

터미널에서 한 번만:

```bash
npm install -g @anthropic-ai/claude-code   # 이미 있으면 생략
claude          # 실행 후 /login
```

앱 안에서 `설정 → 연결 확인`으로 검증할 수 있다.
`ANTHROPIC_API_KEY` 환경변수가 있으면 구독 대신 그쪽으로 과금되니 주의.

---

## 4가지 레버가 앱에서 어떻게 강제되는가

| 레버 | 원리 | 앱의 구현 |
|---|---|---|
| **① 먼저 나부터** | 인출 시도가 있어야 피드백이 붙는다 | **가설 게이트.** 20자 이상 내 추측을 적기 전에는 채팅 자체가 열리지 않는다. 첫 턴은 질문이 아니라 내 가설이 전송된다. |
| **② 답 대신 질문** | 계층적 힌트 | **힌트 사다리 L0→L3.** 기본은 L0(질문만). 단계는 내가 직접 올려야 하고, L3(정답 공개)는 확인 대화상자를 거쳐 기록에 남는다. |
| **③ 인출·재생성** | 덮고 다시 꺼내기 | **인출 카드 + SM-2 간격 반복.** 세션에서 카드를 생성하고, 먼저 내가 답한 뒤에 채점받는다. 모범답안은 채점 후에만 공개된다. |
| **④ 내 말로 검증** | 자기설명 | **설명 탭.** 내가 쓴 설명을 진단만 해준다. 고쳐 쓴 문장은 절대 돌려주지 않고, 구멍마다 **질문**으로 돌려준다. |

### 한 턴에 질문 하나

소크라테스식 튜터의 가장 흔한 실패 모드는 **질문을 한꺼번에 3~4개 던지는 것**이다.
받는 쪽은 어느 것도 끝까지 파고들지 못하고 전부 얕게 훑게 된다 — 의도한 것의 정반대다.

두 겹으로 막는다:

1. **프롬프트** — 시스템 프롬프트와 L0~L2 힌트 지시문 모두 "질문 딱 하나". 나머지 질문은
   적지 말고 보류했다가 학습자가 답한 다음 턴에 꺼내도록 명시.
2. **코드 백스톱** — 응답의 질문 개수를 세서(`countQuestions`) 2개 이상이면 채팅에
   "하나만 물어봐 달라고 하기" 버튼을 띄운다. 코드 블록과 삼항연산자 `a ? b : c` 는 제외.

### Obsidian 내보내기 + 지식 그래프

자기설명 진단 직후 노트가 보관함에 쓰인다 (설정에서 자동/수동 선택).

```
<보관함>/Learn with Claude/
├── 노트/2026-08-02 Node 이벤트 루프.md
└── 개념/microtask.md          ← 허브. 같은 개념을 다시 배우면 여기로 모인다
```

**노트의 소유권은 학습자에게 남긴다.** 원문이 `"노트 정리해줘"`를 안티패턴으로 꼽는 이유가
Claude가 정리한 노트는 읽을 땐 매끄럽지만 내 것이 아니라 인출이 안 되기 때문이다. 그래서:

- **본문 = 내가 '설명' 탭에 쓴 자기설명 그대로.** 한 글자도 고치지 않는다
- Claude 진단은 `> [!warning]` callout 으로 **분리**해서, 내 글과 남의 말이 섞이지 않게 한다
- Claude가 매끈하게 정리한 요약은 **만들지 않는다**
- `## 처음 가설`도 함께 남는다 — 학습 전후의 격차가 노트에 보이도록

**지식 그래프**는 개념 허브 노트로 만든다. 세션에서 추출된 개념마다 노트를 만들고
양방향 `[[wikilink]]`로 잇는다. 허브에는 그 개념의 **인출 성공률**이 박혀서,
Obsidian 그래프 뷰에서 약한 개념이 어디에 몰려 있는지 바로 보인다.

**인출 카드**는 spaced-repetition 플러그인의 multi-line 포맷(`질문 / ? / 답`)과
`#flashcards/<주제>` 덱 태그로 함께 나간다. 앱 밖에서도 복습할 수 있다.

**재내보내기 안전** — 관리 영역을 `<!-- learn-with-claude:begin/end -->` 마커로 감싼다.
마커 바깥에 직접 덧붙인 메모는 다시 내보내도 보존된다. 허브의 학습 링크는 누적된다.

### 안티패턴 감지 (대시보드)

로컬 로그로 즉시 판정한다 — 모델 호출 없음.

- **정답 조기 공개율 ≥ 50%** → 생산적 고투 제거
- **평균 가설 길이 < 40자** → 게이트 형식적 통과
- **자기설명 평균 − 인출 성공률 ≥ 25p** → 유능감의 착각
- **복습 연체 ≥ 5장** → 루프 미완성
- **같은 주제 재질문** → 인출 실패 신호
- 개념별 인출 성공률 < 60% → 약한 개념

---

## 화면

- **탐구** — 가설 게이트 → 소크라테스 튜터 채팅 + 힌트 사다리. 스트리밍 응답.
- **설명** — 자기설명 진단. `정확 / 오류 / 누락 / 뭉갬` 4분류 + 0~100점.
- **인출** — 오늘 복습할 카드 큐. 0~5점 채점 → 다음 복습일 자동 계산.
- **대시보드** — KPI, 14일 활동, 안티패턴 플래그, 개념별 성공률, 코치 한마디.

---

## 구조

```
Clearn/
├── src/
│   ├── main/
│   │   ├── main.js        IPC 핸들러 전체, 알림 스케줄러
│   │   ├── agent.js       Claude Agent SDK 래퍼 (스트리밍·JSON·세션 resume)
│   │   ├── prompts.js     ★ 4가지 레버 프롬프트 — 튜닝은 여기서만
│   │   ├── store.js       JSON 영속성 + SM-2 SRS + 에빙하우스 망각 곡선
│   │   ├── obsidian.js    Obsidian 보관함 내보내기 + DAG 그래프
│   │   └── preload.cjs    contextBridge IPC bridge
│   └── renderer/
│       ├── index.html     UI 진입점
│       ├── app.js         렌더러 전체 로직 (Vanilla JS)
│       └── styles.css     다크 테마, CSS 변수 기반
├── .claude/
│   ├── project-context.md  프로젝트 온톨로지
│   ├── commands/           커스텀 스킬 (/dev, /update-context)
│   └── settings.json       MCP 서버 설정
├── .github/
│   └── workflows/
│       ├── ci.yml              PR 시 구문 검사
│       ├── release.yml         main 머지 시 자동 .dmg 빌드
│       └── auto-release-pr.yml develop 머지 시 릴리즈 PR 자동 생성
├── .githooks/
│   └── pre-push            push 전 JS 구문 확인
├── build/
│   └── icon.icns           macOS 앱 아이콘
├── CLAUDE.md               Claude Code 작업 가이드
├── AGENT.md                Codex CLI 작업 가이드
├── CONTRIBUTING.md         브랜치·커밋·PR 규칙
└── package.json
```

### 데이터 보관

```
~/Library/Application Support/Learn with Claude/
├── data.json          세션 · 카드 · 자기설명 · 이벤트
└── backups/           자동 백업 (최근 10개 유지)
```

이 디렉터리는 **앱 번들 바깥**이라 업데이트·재설치·`npm run dist` 재빌드로 지워지지 않는다.
경로는 앱 이름에서 파생되므로 `main.js`에서 `app.setName('Learn with Claude')`로 못 박아
`productName`을 바꿔도 기존 데이터가 그대로 보이게 했다.

**내구성 장치**

| 상황 | 처리 |
|---|---|
| 쓰는 도중 크래시 | tmp 파일에 쓰고 `rename` — 원자적이라 반쯤 쓰인 파일이 안 생김 |
| `data.json` 손상 | `.corrupt-<ts>` 로 격리 후 최신 백업에서 자동 복구, 설정 화면에 안내 표시 |
| 스키마 변경 | 마이그레이션 **전에** `pre-v{n}` 백업 → `MIGRATIONS[n]` 순차 적용 |
| 구버전으로 롤백 | 미지 필드를 지우지 않고 백업만 남긴 뒤 그대로 둠 |
| 강제 종료 | `before-quit` + `process.on('exit')` 이중 flush |

**스키마를 바꿀 때** — `store.js`의 `SCHEMA_VERSION`을 올리고 `MIGRATIONS`에 함수를 추가한다.
기존 데이터를 지우지 말고 새 필드를 채우기만 할 것.

```js
export const SCHEMA_VERSION = 2;
const MIGRATIONS = {
  2: (d) => { for (const c of d.cards) c.suspended ??= false; },
};
```

설정 화면에서 현재 용량·백업 개수를 보고, 수동 백업과 Finder 열기를 할 수 있다.

### SDK 사용 방식

```js
query({ prompt, options: {
  allowedTools: [],        // 툴 전혀 안 씀 — 순수 대화
  settingSources: [],      // CLAUDE.md / 프로젝트 설정 미로드
  systemPrompt: '...',     // 프리셋 대신 완전 커스텀 (튜터 페르소나)
  includePartialMessages: true,
  resume: sdkSessionId,    // 멀티턴 컨텍스트 유지
}})
```

---

## 테스트

```bash
npm test
```

Electron 런타임과 Agent SDK를 `test/stubs/` 로 대체하고
**메인 프로세스 → preload → 렌더러(jsdom)** 전 구간을 실제로 구동한다. 모델 호출 없음 = 비용 0.

- `test/unit.mjs` (5) — 저장소, SM-2 스케줄러, JSON 파서, 프롬프트 가드레일
- `test/integration.mjs` (14) — IPC 계약, 4가지 레버 워크플로, 대시보드, 영속성, 에러 경로

특히 검증하는 것:

- 가설 20자 미만이면 **UI와 메인 양쪽에서** 차단되는가
- 첫 턴이 질문이 아니라 *가설*로 전송되는가
- SDK 호출이 `allowedTools: []`, `settingSources: []`, 커스텀 시스템 프롬프트로 나가는가
- 프롬프트에 `[HINT_LEVEL=n]`이 정확히 주입되고 멀티턴 `resume`이 붙는가
- **답을 제출하기 전에 모범답안이 DOM에 노출되지 않는가** (인출 연습의 핵심)

### 이 테스트가 못 잡는 것

실제 Chromium 창을 띄우지는 않으므로 다음은 직접 `npm start`로 확인해야 한다:

- CSS 레이아웃 / `titleBarStyle: 'hiddenInset'` 렌더링
- `file://` 문서에서의 CSP 동작
- 실제 Claude 로그인 및 모델 응답 품질
- `npm run dist` 패키징 후 asar 안에서 SDK 바이너리 spawn

---

## 튜닝 포인트

- **튜터가 너무 쉽게 답을 준다** → `prompts.js`의 `HINT_LADDER[n].directive` 강화
- **채점이 후하다** → `recallGraderPrompt`의 grade 기준 조정
- **가설 게이트가 답답하다** → `main.js`의 `session:create` 핸들러에서 최소 길이 변경 (권장하지 않음 — 그 답답함이 기능이다)
- **모델 변경** → 설정 탭 (sonnet / opus / haiku)

---

## 알려진 제약

- 코드 블록 문법 강조 없음 (일부러 — 긴 코드를 받는 UI를 만들지 않음)
- 세션 검색/태그 필터 없음
- 첨부파일·이미지 미지원
- macOS 기준으로만 확인 (Electron이라 다른 OS도 동작은 하나 타이틀바 스타일이 다름)
