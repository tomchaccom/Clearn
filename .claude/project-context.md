# Clearn 프로젝트 온톨로지

_마지막 갱신: 2026-08-15_

## 한 줄 요약

Claude Code 구독 기반 Electron 학습 앱. 소크라테스 튜터 + 인출 연습 + 자기설명 검증으로 "이해했다는 느낌" 대신 실제 인출 데이터로 학습을 확인한다.

---

## 핵심 아키텍처

```
┌─────────────────────────────────────┐
│         Electron Main Process       │
│  main.js  agent.js  store.js        │
│  obsidian.js  prompts.js            │
│  ↕ IPC (preload.cjs bridge)         │
├─────────────────────────────────────┤
│       Electron Renderer Process     │
│  index.html  app.js  styles.css     │
└─────────────────────────────────────┘
         ↕ Claude Agent SDK
    로컬 Claude Code 구독 인증
```

- **Main Process**: Node.js ESM, IPC 핸들러, 파일 I/O, Claude SDK 호출
- **Renderer Process**: 순수 HTML/CSS/JS (프레임워크 없음), IPC 통신
- **preload.cjs**: contextBridge로 IPC를 `window.api.*`로 노출
- **인증**: `~/.claude` 로컬 Claude Code 로그인 (구독 필수)

---

## 주요 파일 맵

| 경로 | 역할 |
|------|------|
| `src/main/main.js` | 앱 진입점, BrowserWindow, 전체 IPC 핸들러 등록 |
| `src/main/agent.js` | Claude Agent SDK 래퍼, 스트리밍, abort, JSON 헬퍼 |
| `src/main/store.js` | 로컬 JSON 저장소, SM-2 SRS 스케줄러, 안티패턴 감지 |
| `src/main/obsidian.js` | Obsidian 내보내기 (세션 노트 + 개념 허브) |
| `src/main/prompts.js` | 모든 시스템/유저 프롬프트 (tutor, grader, cardgen, coach) |
| `src/main/preload.cjs` | IPC bridge → `window.api.*` |
| `src/renderer/index.html` | 전체 UI HTML (온보딩 + 5개 탭 + 설정 모달) |
| `src/renderer/app.js` | 렌더러 로직 (탭, 스트리밍, 온보딩, 카드, 대시보드) |
| `src/renderer/styles.css` | CSS 변수 기반 다크 테마 |
| `test/unit.mjs` | 단위 테스트 |
| `test/integration.mjs` | 통합 테스트 |
| `.claude/commands/dev.md` | 개발 워크플로우 스킬 (이슈→PR→배포) |
| `.claude/commands/update-context.md` | 이 파일 갱신 스킬 |

---

## 핵심 기능

| 기능 | 탭 | 설명 |
|------|-----|------|
| **레버 1: 먼저 나부터** | 탐구 | 질문 + 가설(≥20자) 입력 후 학습 시작 |
| **레버 2: 소크라테스 튜터** | 탐구 | 힌트 사다리 L0~L3, 스트리밍 대화 |
| **레버 3: 인출 연습** | 인출 | SM-2 SRS 플래시카드, 채점 피드백 |
| **레버 4: 자기설명 검증** | 설명 | 60자 이상 설명 → Claude 진단 (구멍 질문) |
| **대시보드** | 대시보드 | KPI, 안티패턴 감지, AI 코치 한마디 |
| **Obsidian 연동** | 설정 | 자기설명 → 노트 + 개념 허브 자동 내보내기 |
| **온보딩** | - | 첫 실행 시 4단계 플로우 (환영→Claude 연결→Obsidian→완료) |

---

## IPC 채널 목록 (`window.api.*`)

```
settings.get / settings.set
onboarding.complete
health()
abort(requestId)
ladder() / narrowRequest()
data.info / data.backup / data.reveal
session.list / session.get / session.create / session.hint / session.send
obsidian.check / obsidian.pick / obsidian.export / obsidian.reveal
explain.grade / explain.list
cards.generate / cards.due / cards.all / cards.answer / cards.remove
stats.get / stats.coach
onDelta(cb)  ← stream:delta 이벤트 리스너
```

---

## 데이터 스키마 (`store.js`)

```js
{
  version: 1,
  settings: {
    learnerLevel: string,   // 튜터 프롬프트 삽입
    model: 'sonnet'|'opus'|'haiku',
    obsidianVault: string,  // 빈 값이면 Obsidian 비활성
    obsidianFolder: string, // 기본 'Learn with Claude'
    obsidianAuto: boolean,  // 진단 후 자동 내보내기
    obsidianCards: boolean, // 인출 카드 포함 여부
    onboardingDone: boolean // 첫 실행 온보딩 완료 여부
  },
  sessions: [{ id, topic, question, hypothesis, sdkSessionId, hintLevel, maxHintLevel, messages[], createdAt }],
  cards: [{ id, sessionId, front, back, concept, kind, ease, interval, due, reps, lapses, history[] }],
  explains: [{ id, sessionId, topic, text, score, verdict, findings[], concepts[], createdAt }],
  events: [{ t, type, ...payload }]
}
```

---

## 기술 스택

- **런타임**: Electron v33, Node.js ESM (`"type": "module"`)
- **AI**: `@anthropic-ai/claude-agent-sdk ^0.3.220` (로컬 인증)
- **저장소**: 로컬 JSON 원자적 쓰기 (`~/Library/Application Support/Learn with Claude/`)
- **SRS**: SM-2 알고리즘 (자체 구현)
- **UI**: 순수 HTML/CSS/JS, CSS 변수 다크 테마 (`--bg`, `--accent` 등)
- **빌드**: `electron-builder` → macOS `.dmg` (arm64)
- **테스트**: Node.js 내장 (setup.mjs + jsdom)

---

## 개발 워크플로우

```
이슈 생성 → feature/issue-{N}-{desc} 브랜치 (from develop)
→ 작업 + 커밋 (feat(scope): 설명)
→ PR to develop → CI (npm test)
→ develop → main PR → 자동 빌드 + draft 릴리즈
```

- **브랜치**: `feature/issue-N-desc`, `fix/issue-N-desc`
- **커밋**: 한국어 Conventional Commits + scope (`feat(ui): ...`)
- **CI**: `.github/workflows/ci.yml` (main/develop PR 시 테스트)
- **배포**: `.github/workflows/release.yml` (main push 시 자동 빌드)
- **스킬**: `/dev {할 일}` → 이슈→브랜치→PR→배포 단계별 안내

---

## 현재 상태 & 제한사항

**완료된 기능:**
- 4-레버 학습 플로우 전체
- Obsidian 연동 (세션 노트 + 개념 허브 + SRS 포맷)
- SM-2 SRS 인출 카드
- 대시보드 (KPI + 안티패턴 6종 + AI 코치)
- 첫 실행 온보딩 4단계
- git flow + CI/CD

**알려진 제한:**
- 코드 서명 없음 → macOS Gatekeeper 경고
- auto-update 없음 → 수동 재설치
- Claude Code 구독 필수 (다른 인증 불가)
- arm64(Apple Silicon) 전용 빌드

---

## 다음 세션을 위한 힌트

1. **코드 읽기 시작점**: `src/main/main.js` (IPC 전체 구조), `src/renderer/app.js` (렌더러 부팅 IIFE)
2. **UI 수정**: `index.html` + `styles.css` + `app.js` 세트로 작업
3. **새 IPC 추가 순서**: `main.js handle()` → `preload.cjs invoke()` → `app.js window.api.*`
4. **스키마 변경 시**: `store.js`의 `SCHEMA_VERSION` 올리고 `MIGRATIONS`에 함수 추가
5. **현재 열린 이슈**: #1(ontology), #2(MCP), #3(usage UI), #4(app icon)
6. **개발 명령**: `npm start` (개발), `npm run dist` (빌드), `npm test` (테스트)
