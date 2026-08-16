# MD 파일 검수 결과

## 검수 대상 파일 목록

| 파일 경로 | 역할 요약 |
|-----------|----------|
| `CLAUDE.md` | Claude Code 전용 작업 규칙, 핵심 파일 목록, 빌드 명령, 아키텍처 규칙 |
| `AGENT.md` | Codex CLI 등 타 에이전트용 온보딩 문서 |
| `README.md` | 프로젝트 공개 문서 (설치, 기능, 구조, 튜닝 포인트 등) |
| `CONTRIBUTING.md` | 브랜치 전략, 커밋 규칙, PR 프로세스 |
| `.claude/project-context.md` | 아키텍처·도메인 모델·IPC 채널·데이터 스키마·현재 상태 |
| `.claude/mcp-guide.md` | MCP 서버 등록 목록 및 사용법 |
| `.claude/commands/dev.md` | `/dev` 슬래시 커맨드: 이슈→브랜치→PR→릴리즈→버전 bump |
| `.claude/commands/update-context.md` | `/update-context` 슬래시 커맨드: project-context.md 갱신 절차 |
| `.claude/commands/troubleshoot.md` | `/troubleshoot` 슬래시 커맨드: TROUBLESHOOTING.md 조회·기록 |
| `docs/TROUBLESHOOTING.md` | 실행 중 발생한 문제와 해결책 누적 기록 |
| `docs/BRANCH_CLEANUP.md` | 브랜치·이슈 정리 절차 및 이력 |
| `.github/pull_request_template.md` | PR 작성 템플릿 |
| `.github/ISSUE_TEMPLATE/bug.md` | 버그 리포트 이슈 템플릿 |
| `.github/ISSUE_TEMPLATE/feature.md` | 기능 요청 이슈 템플릿 |

---

## 충돌·불일치 항목

### [충돌 1] 커밋 메시지 언어 규칙

- **CLAUDE.md**: "한국어 Conventional Commits with scope" — 예시가 한국어 본문
- **AGENT.md** (`경로: AGENT.md`): 커밋 형식 예시에 본문 언어 명시 없음 (`feat(scope): 내용`)
- **CONTRIBUTING.md**: "한국어 Conventional Commits 형식"으로 한국어임을 명시, 예시도 한국어
- **권장 해결**: 실질적 충돌은 없으나 AGENT.md의 예시에 한국어 샘플을 추가하거나 CLAUDE.md·CONTRIBUTING.md를 참조하도록 안내 추가

---

### [충돌 2] `release/v{버전}` 브랜치 타입 언급 범위

- **CONTRIBUTING.md**: 브랜치 이름 규칙 표에 `release/v{버전}` 타입 명시
- **CLAUDE.md**, **AGENT.md**, **project-context.md**: 브랜치 패턴으로 `feature/issue-N-desc`, `fix/issue-N-desc`만 나열, `release/` 언급 없음
- **dev.md**: 릴리즈 PR은 develop→main 직접 PR로 처리하고 `release/` 브랜치는 사용하지 않는 흐름으로 기술
- **권장 해결**: 실제 워크플로우가 `release/` 브랜치를 쓰지 않는다면 CONTRIBUTING.md에서 해당 행을 삭제. 실제로 쓴다면 dev.md에 단계를 추가.

---

### [충돌 3] `.claude/memory/MEMORY.md` 경로 참조 — 파일 미존재

- **CLAUDE.md** (77번째 줄): `".claude/memory/MEMORY.md" — 세션 간 지속 컨텍스트`로 참조
- **실제 파일시스템**: `.claude/memory/` 디렉터리 자체가 없음
- **권장 해결**: 해당 기능을 실제로 사용하고 있지 않다면 CLAUDE.md의 해당 줄을 삭제. 사용 예정이라면 디렉터리와 파일을 생성.

---

### [충돌 4] 데이터 스키마 버전 불일치

- **project-context.md** (데이터 스키마 섹션): `version: 1`로 표기
- **README.md** (스키마 변경 예시 코드): `export const SCHEMA_VERSION = 2;` 예시 사용
- **권장 해결**: project-context.md의 스키마 버전을 실제 `store.js`의 `SCHEMA_VERSION` 값과 동기화. README 예시는 단순 코드 샘플이므로 project-context.md를 소스 오브 트루스로 유지.

---

### [충돌 5] Electron 버전 기술 위치

- **AGENT.md**: `Electron 33 (Node.js 22 기반)`으로 명시
- **project-context.md**: `Electron v33, Node.js ESM`으로 명시 (Node 버전 미기재)
- **CLAUDE.md**, **README.md**: Electron 버전 명시 없음
- **권장 해결**: 버전 정보는 `package.json`이 소스 오브 트루스이므로 MD 파일에서 버전 숫자를 제거하거나, `project-context.md`에만 남기고 나머지는 "package.json 참조"로 통일.

---

## 중복 기술 항목

### [중복 1] 아키텍처 규칙 4개항

동일한 4개 규칙(IPC bridge, 렌더러 Node.js 금지, store.js 통해 데이터, prompts.js에 추가)이 아래 파일에 전부 기재됨:
- `CLAUDE.md` (아키텍처 규칙 섹션)
- `AGENT.md` (작업 규칙 섹션)
- `project-context.md` (다음 세션을 위한 힌트 + 아키텍처 섹션에 산재)

**권장 해결**: `CLAUDE.md`를 정본으로 유지. `AGENT.md`는 "CLAUDE.md의 아키텍처 규칙 참조"로 줄임. `project-context.md`는 코드 읽기 순서 힌트만 남김.

---

### [중복 2] 핵심 파일 목록

소스 파일 → 역할 매핑 테이블이 아래 4곳에 중복:
- `CLAUDE.md` (핵심 파일 표)
- `AGENT.md` (주요 파일 표, "수정 대상" 관점)
- `project-context.md` (주요 파일 맵)
- `README.md` (구조 트리)

**권장 해결**: `project-context.md`가 가장 상세하므로 소스 오브 트루스로 지정. CLAUDE.md와 AGENT.md는 짧은 요약만 유지하고 "전체 목록은 project-context.md 참조"로 링크.

---

### [중복 3] 브랜치 전략 요약

- `CLAUDE.md`, `AGENT.md`, `project-context.md`, `CONTRIBUTING.md`, `dev.md` 다섯 파일에 동일한 git flow 전략이 기재됨
- **권장 해결**: `CONTRIBUTING.md`가 정본. 나머지는 "→ CONTRIBUTING.md 참조"로 통일(CLAUDE.md는 이미 이렇게 처리되어 있음, AGENT.md·project-context.md도 동일하게).

---

### [중복 4] 빌드 명령

`npm start / npm test / npm run dist` 3줄이 CLAUDE.md, AGENT.md, project-context.md, README.md 네 곳에 중복.
**권장 해결**: README.md에만 풀 설명 유지. 나머지는 한 줄로 줄이거나 README 참조.

---

## 현실 불일치 항목 (코드와 맞지 않는 설명)

### [불일치 1] `.claude/memory/MEMORY.md` 미존재

- `CLAUDE.md`에서 참조하지만 해당 경로에 파일 없음 (위 충돌 3과 동일).

---

### [불일치 2] `project-context.md`의 "현재 열린 이슈" 목록

- `project-context.md` 마지막 줄: `"현재 열린 이슈: #1(ontology), #2(MCP), #3(usage UI), #4(app icon)"`
- `docs/BRANCH_CLEANUP.md` 정리 이력: 2026-08-16에 feature/issue-1~4 브랜치와 이슈 #9~14, #21~24를 닫음 기록
- 이슈 #1~4가 여전히 열려 있는지 실제 GitHub 상태와 맞지 않을 수 있음
- **권장 해결**: `/update-context` 커맨드를 실행해 이슈 목록 최신화.

---

### [불일치 3] `project-context.md` 갱신일과 실제 작업일

- `project-context.md`: `_마지막 갱신: 2026-08-15_`
- `docs/BRANCH_CLEANUP.md`: 2026-08-16 브랜치 정리 이력 존재
- BRANCH_CLEANUP 내용이 project-context.md에 반영되지 않음
- **권장 해결**: `/update-context` 커맨드로 갱신 후 날짜 업데이트.

---

### [불일치 4] `README.md`의 Obsidian 내보내기 경로 예시

- `README.md`: `<보관함>/Learn with Claude/` → `노트/2026-08-02 Node 이벤트 루프.md`
- 실제 test 데이터: `test/.tmp-userdata/vault/LWC/노트/2026-08-16 Node 이벤트 루프.md` (폴더명이 `LWC`로 축약)
- test 환경의 vault 폴더 이름이 README 예시와 다름 (단, 설정값이므로 기능적 문제는 없음)
- **권장 해결**: README는 기본값(`Learn with Claude`) 기준으로 기술된 것이므로 충돌 아님. 단, 설정에서 변경 가능하다는 안내 추가를 고려.

---

## 권장 조치 요약

| 우선순위 | 항목 | 조치 |
|----------|------|------|
| 높음 | `.claude/memory/MEMORY.md` 미존재 | CLAUDE.md에서 해당 줄 삭제 또는 파일 생성 |
| 높음 | `project-context.md` 갱신 | `/update-context` 실행해 이슈 목록·날짜 최신화 |
| 중간 | `release/` 브랜치 언급 정합 | 실제 사용 여부 확인 후 CONTRIBUTING.md 또는 dev.md 수정 |
| 중간 | 스키마 버전 동기화 | `store.js`의 실제 값을 `project-context.md`에 반영 |
| 낮음 | 아키텍처 규칙·파일 목록 중복 | CLAUDE.md 정본 유지, 나머지는 참조 링크로 축약 |
| 낮음 | 빌드 명령 중복 | README.md 정본, 나머지 파일에서 제거 또는 참조 |
| 낮음 | Electron/Node 버전 숫자 분산 | package.json을 소스 오브 트루스로, MD에서는 버전 숫자 제거 |
