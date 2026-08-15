# Clearn 개발용 MCP 가이드

`.claude/settings.json`에 등록된 MCP 서버 목록과 사용법.

---

## 등록된 MCP

### 1. GitHub MCP (`@modelcontextprotocol/server-github`)

**선택 이유**: Clearn은 GitHub(tomchaccom/Clearn)으로 소스를 관리하고 git flow 전략을 사용한다. 이슈 생성, PR 관리, 코드 리뷰 코멘트 등을 Claude Code 내에서 직접 처리할 수 있다.

**사전 설정 필요**:
1. GitHub Personal Access Token 발급 (repo, issues, pull_requests 권한)
   - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. `.claude/settings.json`의 `GITHUB_PERSONAL_ACCESS_TOKEN` 값에 토큰 입력
   - ⚠️ 토큰은 절대 git에 커밋하지 말 것 (`.gitignore`에 추가 고려)

**사용 예시**:
```
# 이슈 목록 조회
"tomchaccom/Clearn의 열린 이슈 목록 보여줘"

# PR 생성
"develop에서 main으로 PR 만들어줘, 제목은 'v0.2.0 릴리즈'"

# 코드 리뷰
"PR #5의 변경사항 리뷰해줘"
```

---

### 2. Filesystem MCP (`@modelcontextprotocol/server-filesystem`)

**선택 이유**: 개발 중 여러 파일을 동시에 탐색하거나, Claude Code의 기본 파일 도구보다 더 풍부한 파일시스템 작업이 필요할 때 유용하다.

**접근 가능 경로**: `/Users/myeongsung/Desktop/today-timeblock/learn-with-claude` (프로젝트 루트)

**사용 예시**:
```
# 파일 구조 탐색
"src/renderer 폴더 구조 보여줘"

# 특정 패턴 파일 검색
"IPC 채널이 정의된 파일 찾아줘"
```

---

## 미등록 MCP (검토 후 필요 시 추가)

| MCP | 이유 |
|-----|------|
| `@modelcontextprotocol/server-brave-search` | WebSearch 이미 내장, 중복 |
| `@modelcontextprotocol/server-sqlite` | JSON 저장소 사용, 불필요 |
| Obsidian MCP (비공식) | Electron에서 직접 처리 중, 중복 |

---

## 설치 및 활성화 방법

MCP는 Claude Code가 자동으로 감지한다. 추가 설치 없이 `.claude/settings.json`만 있으면 됨.

단, GitHub MCP는 토큰 설정이 필요:
```bash
# settings.json 편집 (로컬에서만, git 커밋 금지)
# GITHUB_PERSONAL_ACCESS_TOKEN 값에 토큰 입력
```

토큰을 환경변수로 관리하려면:
```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
```
그리고 settings.json에서 값을 빈 문자열로 두면 환경변수를 자동 참조.
