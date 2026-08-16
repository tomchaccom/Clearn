# Clearn 컨텍스트 세팅

이 스킬은 Clearn 레포에서 작업을 시작할 때 실행한다.
$ARGUMENTS가 있으면 해당 작업 유형에 맞는 섹션만 읽는다.
(예: `/setup-context 프롬프트 튜닝`)

---

## 레포 MD 파일 지도

| 파일 경로 | 역할 | 언제 읽는가 |
|-----------|------|------------|
| `CLAUDE.md` | Claude Code 작업 규칙, 핵심 파일 목록, 아키텍처 규칙 | **항상 먼저** |
| `CONTRIBUTING.md` | 브랜치 전략, 커밋 형식, PR 프로세스 **정본** | 이슈·브랜치·PR 만들기 전 |
| `.claude/project-context.md` | 아키텍처·도메인 모델·IPC 채널·데이터 스키마 **정본** | 새 기능 설계 전, 구조 파악 시 |
| `.claude/commands/dev.md` | `/dev` 커맨드: 이슈→브랜치→PR→릴리즈→버전 bump 전체 흐름 | 개발 워크플로 시작 시 |
| `.claude/commands/update-context.md` | `/update-context` 커맨드: project-context.md 갱신 절차 | 큰 작업 완료 후 |
| `.claude/commands/troubleshoot.md` | `/troubleshoot` 커맨드: 문제 발생 시 조회·기록 | 에러 발생 시 |
| `.claude/mcp-guide.md` | GitHub MCP, Filesystem MCP 사용법 | MCP 도구 호출 전 |
| `docs/TROUBLESHOOTING.md` | 과거 문제와 해결책 누적 기록 | 에러 발생 시 가장 먼저 |
| `docs/BRANCH_CLEANUP.md` | 브랜치·이슈 정리 이력 | 오래된 브랜치 정리 시 |
| `docs/md-review.md` | MD 파일 간 충돌·중복·불일치 검수 결과 | MD 파일 수정 전 |
| `AGENT.md` | Codex CLI 등 타 에이전트용 온보딩 | Claude Code 외 에이전트 사용 시 |
| `.github/pull_request_template.md` | PR 본문 양식 | PR 생성 시 |

---

## 상황별 작업 가이드

### 새 기능 개발

1. **읽어야 할 파일**: `CLAUDE.md` → `CONTRIBUTING.md` → `.claude/project-context.md`
2. **흐름**: `/dev` 커맨드 실행 — 이슈 생성 → `feature/issue-N-설명` 브랜치 → 코드 → PR
3. **주의**:
   - IPC는 반드시 `preload.cjs`의 contextBridge를 통해서만 노출
   - 렌더러에서 Node.js API 직접 사용 금지
   - 새 프롬프트는 `prompts.js`에 추가 후 `main.js`에서 import
   - 데이터 읽기/쓰기는 `store.js`를 통해서만

### 버그 수정

1. **읽어야 할 파일**: `docs/TROUBLESHOOTING.md` (이미 해결책 있는지 확인) → `CLAUDE.md`
2. **흐름**: `/dev` 커맨드 — `fix/issue-N-설명` 브랜치 사용
3. **완료 후**: 새 케이스면 `docs/TROUBLESHOOTING.md`에 증상·원인·해결책 추가

### 프롬프트 튜닝

1. **읽어야 할 파일**: `src/main/prompts.js` 전체
2. **수정 위치**: `prompts.js` 만 수정 — 다른 파일 건드리지 않는다
3. **테스트**: `npm test` — 프롬프트 가드레일 테스트가 포함되어 있음 (unit.mjs)
4. **주의**: HINT_LADDER 이름 변경 시 `test/unit.mjs`, `test/stubs/sdk.mjs`, `test/integration.mjs`의 문자열 assertion도 함께 수정

### 테스트 실패 디버깅

1. **읽어야 할 파일**: `docs/TROUBLESHOOTING.md` → `test/unit.mjs` → `test/integration.mjs`
2. **테스트 구조**:
   - `test/unit.mjs` — 단위 테스트 (모델 호출 없음, 빠름)
   - `test/integration.mjs` — JSDOM + mock SDK로 렌더러 전체 흐름 검증
   - `test/e2e/smoke.spec.js` — Playwright E2E (CI에서 실행)
3. **mock SDK 위치**: `test/stubs/sdk.mjs` — AI 응답 패턴 변경 필요 시 여기서 수정
4. **실행**: `npm test` (unit + integration), `npm run test:e2e` (E2E)

### 릴리즈 준비

1. **읽어야 할 파일**: `.claude/commands/dev.md` (5단계·6단계)
2. **흐름**:
   - develop → main PR 머지 → release.yml 자동 빌드 → `.dmg` draft 업로드
   - GitHub Releases에서 draft 확인 → 릴리즈 노트 보완 → publish
   - develop에서 버전 bump (minor: 새 기능, patch: 버그만, major: 하위 호환 파괴)
3. **주의**: `main` 브랜치에 직접 커밋 금지. develop PR을 통해서만.

### Obsidian 연동 수정

1. **읽어야 할 파일**: `src/main/obsidian.js` (전체) → `src/main/main.js` (`obsidian:*` IPC 핸들러)
2. **관련 IPC**: `obsidian:pick`, `obsidian:check`, `obsidian:export`, `obsidian:buildDag`, `obsidian:buildConceptNote`
3. **렌더러 연동**: `src/renderer/app.js`의 `renderObsInfo()`, `renderObsidianRow()`
4. **테스트**: `test/integration.mjs`의 Obsidian 섹션 (보관함 선택 → 자동 저장 → 노트 생성 확인)

---

## 절대 규칙

다음은 `CLAUDE.md`와 `CONTRIBUTING.md`에서 추출한 절대 규칙이다. 어떤 작업이든 이 규칙은 반드시 지킨다.

1. **IPC bridge 필수**: 모든 IPC는 `preload.cjs`의 `contextBridge`를 통해서만 노출
2. **렌더러 Node.js 금지**: `src/renderer/` 파일에서 `require`, `fs`, `path` 등 Node.js API 직접 사용 금지
3. **데이터는 store.js 경유**: 데이터 읽기/쓰기는 반드시 `store.js`를 통해서만
4. **프롬프트는 prompts.js**: 새 프롬프트·기존 프롬프트 수정은 `src/main/prompts.js`에서만
5. **브랜치 보호**: `main`은 develop PR을 통해서만. `develop`은 feature/fix 브랜치 PR로만
6. **커밋 형식**: 한국어 Conventional Commits + scope — `feat(tutor): 설명`, `fix(store): 설명`
7. **문제 발생 시**: `docs/TROUBLESHOOTING.md` 먼저 확인 → 해결 후 없으면 항목 추가
8. **컨텍스트 갱신**: 큰 변경 후 `/update-context` 실행해 `project-context.md` 최신화
9. **pre-push hook**: `.githooks/pre-push`에서 JS 문법 검사 실행 — `--no-verify` 금지
10. **테스트 통과**: PR 올리기 전 반드시 `npm test` 통과 확인

---

## 주의사항 (md-review.md 요약)

`docs/md-review.md`에 전체 검수 결과가 있다. 작업 전 아래 사항을 인지하라.

### 즉시 조치 필요
- **`.claude/memory/MEMORY.md` 경로가 CLAUDE.md에 언급되어 있으나 파일 미존재** — 해당 경로 참조 삭제 또는 파일 생성 필요
- **`project-context.md`의 이슈 목록과 갱신일이 outdated** — `/update-context` 실행 필요

### 소스 오브 트루스 정리
| 주제 | 정본 파일 | 나머지 파일 처리 |
|------|----------|----------------|
| 아키텍처 규칙 | `CLAUDE.md` | 나머지는 참조 링크로 |
| 브랜치 전략 | `CONTRIBUTING.md` | 나머지는 참조 링크로 |
| 파일 역할 상세 | `project-context.md` | 나머지는 요약만 유지 |
| 버전 정보 | `package.json` | MD에서 버전 숫자 제거 |

### 현실과 다른 내용
- `release/v{버전}` 브랜치 타입이 `CONTRIBUTING.md`에 명시되어 있으나 실제로는 develop→main PR 방식 사용
- README의 Obsidian 내보내기 예시 폴더명(`Learn with Claude`)이 테스트 환경(`LWC`)과 다름 (기능 문제 없음, 설명상 주의)
