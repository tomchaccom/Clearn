# Clearn 개발 워크플로우

CONTRIBUTING.md의 git flow 전략을 따라 아래 단계를 순서대로 진행한다.
사용자가 명시하지 않은 단계는 건너뛰지 않는다.

## 인자 처리

$ARGUMENTS 가 있으면 작업 내용으로 사용한다.
없으면 사용자에게 "어떤 작업을 할까요? (기능/버그)" 를 먼저 묻는다.

## 단계별 진행

### 1단계: 이슈 생성

사용자에게 이슈 제목과 설명을 확인한 후 생성한다.

```bash
gh issue create \
  --repo tomchaccom/Clearn \
  --title "{이슈 제목}" \
  --body "{이슈 설명}" \
  --label "{feature 또는 bug}"
```

생성된 이슈 번호를 기억한다.

### 2단계: 브랜치 생성

develop 최신화 후 이슈 브랜치를 만든다.

```bash
git checkout develop && git pull origin develop
git checkout -b {feature 또는 fix}/issue-{번호}-{짧은-설명}
```

브랜치명 규칙: CONTRIBUTING.md 참고
- 기능: `feature/issue-{번호}-{설명}`
- 버그: `fix/issue-{번호}-{설명}`

### 3단계: 작업 진행

사용자가 코드 작업을 완료했다고 하면 다음 단계로 넘어간다.
작업 중에는 커밋 메시지 규칙(한국어 Conventional Commits)을 안내한다.

### 4단계: PR 생성

변경된 파일과 diff를 확인하고, PR 본문을 작성한다.
UI 변경이 있는지 사용자에게 확인한다 (있으면 스크린샷 안내).

```bash
gh pr create \
  --repo tomchaccom/Clearn \
  --base develop \
  --title "[#{이슈번호}] {작업 내용 한 줄 요약}" \
  --body "..."
```

PR 본문은 `.github/pull_request_template.md` 형식을 따른다:
- 관련 이슈 (`closes #{번호}`)
- 작업 내용 bullet
- UI 변경 스크린샷 (해당 시)
- 체크리스트

### 5단계: main 머지 및 릴리즈

develop → main PR이 머지되면 GitHub Actions가 자동으로:
1. 빌드 실행 (`npm run dist`)
2. draft 릴리즈 생성 (`.dmg` 첨부)

사용자에게 안내:
- GitHub Releases에서 draft 릴리즈 확인
- 릴리즈 노트에 변경사항 상세 보완 후 publish

릴리즈 노트 포함 권장 내용:
- 추가된 기능
- 수정된 버그
- 변경된 UI (스크린샷)
- 요구사항 (Claude Code 구독)

## 롤백

문제 발생 시 이전 릴리즈 태그로 롤백:
```bash
git checkout main
git revert {문제 커밋 해시}
# 또는 GitHub Releases에서 이전 버전 .dmg 공유
```
