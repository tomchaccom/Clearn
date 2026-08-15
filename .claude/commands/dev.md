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
작업 중에는 커밋 메시지 규칙(한국어 Conventional Commits + scope)을 안내한다.
형식: `type(scope): 설명` — scope는 변경된 영역 (예: tutor, session, ui, agent, store)

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

### 5단계: 릴리즈 PR 생성 → main 머지 → 빌드

자동화 흐름 (워크플로 파일 기준):

```
develop push
  └─► auto-release-pr.yml
        ├─ 기존 develop→main PR 없으면 자동 생성
        └─ PR 본문: 머지된 PR 목록 + 커밋 요약 + 체크리스트

develop→main PR merge
  └─► release.yml (macos-latest)
        ├─ npm ci → npm run dist (electron-builder --mac)
        └─ softprops/action-gh-release: draft .dmg 업로드
```

릴리즈 PR 머지 후 해야 할 것:
1. GitHub Releases에서 draft 확인 → 릴리즈 노트 보완 → publish
2. 6단계로 이동해 develop 버전 bump

릴리즈 노트 권장 내용:
- 추가된 기능 (레버별)
- 수정된 버그
- 변경된 UI (스크린샷)
- 요구사항 (macOS Apple Silicon + Claude Code 구독)

### 6단계: 릴리즈 버전 갱신

main 머지 완료 후 develop에서 버전을 올린다.

```bash
git checkout develop && git pull origin develop

# minor 버전 bump (예: 0.1.0 → 0.2.0)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version = \`\${major}.\${minor + 1}.0\`;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('bumped to', pkg.version);
"

git add package.json
git commit -m "chore: v{새 버전}으로 버전 bump"
git push origin develop
```

버전 규칙:
- **patch** (`0.1.x`): 버그 수정만
- **minor** (`0.x.0`): 새 기능 추가
- **major** (`x.0.0`): 하위 호환 깨지는 변경

## 롤백

문제 발생 시 이전 릴리즈 태그로 롤백:
```bash
git checkout main
git revert {문제 커밋 해시}
# 또는 GitHub Releases에서 이전 버전 .dmg 공유
```
