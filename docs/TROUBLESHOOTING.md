# 트러블슈팅 가이드

> Claude Code 실행 중 문제 발생 시 이 파일을 먼저 확인하세요.
> 해결책이 없으면 조치 후 하단에 새 항목을 추가하세요.

---

## 1. 서브 에이전트 권한 거부 (Permission Denied)

**증상**: Agent 도구로 서브 에이전트 실행 시 Read/Write/Bash 권한 거부로 즉시 실패

**원인**: Claude Code의 권한 모드가 서브 에이전트에 자동 전파되지 않음

**해결책**: 서브 에이전트 대신 메인 컨텍스트에서 git worktree로 직접 처리
```bash
git worktree add /tmp/feature-name origin/feature/branch-name
# 작업 완료 후
git worktree remove /tmp/feature-name --force
```
서브 에이전트는 Research(탐색·조회) 전용으로만 사용. 파일 수정·커밋·푸시는 메인에서 직접.

---

## 2. Worktree 충돌 — "already checked out"

**증상**: `git worktree add` 시 "branch already checked out at '/tmp/...'" 오류

**원인**: 이전 세션의 worktree가 정리되지 않고 남아 있음

**해결책**:
```bash
git worktree list                          # 목록 확인
git worktree remove /tmp/path --force     # 강제 제거
git worktree prune                         # 고아 worktree 정리
```

---

## 3. Rebase 중 Fix Commit 유실

**증상**: force-push 후 CI에서 이전에 수정한 오류가 다시 발생

**원인**: 새 worktree가 로컬 추적 브랜치(fix commit 미포함)를 기준으로 생성돼 rebase가 fix commit을 덮어씀

**해결책**:
```bash
git log --oneline origin/feature/branch-name  # rebase 전 확인
git fetch && git log --oneline origin/branch  # push 후 원격 확인
git cherry-pick <fix-commit-hash>             # fix commit 누락 시
git push origin branch --force-with-lease
```

---

## 4. IPC Export 누락 — SyntaxError

**증상**: `SyntaxError: The requested module './prompts.js' does not provide an export named 'XxxPrompt'`

**원인**: main.js에서 import하는 함수가 prompts.js에 export 누락. 커밋 누락 또는 rebase 유실.

**해결책**:
```bash
git show origin/branch:src/main/prompts.js | grep "export function"
# 누락 확인 후 함수 추가, 재커밋, 재push
```

---

## 5. PR Merge Conflict

**증상**: `gh pr merge` 시 "Pull Request has merge conflicts" 오류

**원인**: 여러 feature 브랜치가 동일 파일(styles.css, app.js) 동시 수정

**해결책**:
```bash
git worktree add /tmp/fix-pr origin/feature/branch-name
cd /tmp/fix-pr
git rebase origin/develop
# 충돌 파일에서 <<<< HEAD / ==== / >>>> 마커 수동 해결
git add <충돌파일>
git rebase --continue
git push origin feature/branch-name --force-with-lease
git worktree remove /tmp/fix-pr
```

---

## 6. `--delete-branch` 로컬 브랜치 삭제 실패

**증상**: "cannot delete branch 'xxx' used by worktree at '/tmp/...'"

**원인**: 로컬에 해당 브랜치를 사용하는 worktree 존재

**해결책**:
```bash
git worktree remove /tmp/path --force
gh pr merge <number> --squash --delete-branch
```
원격 삭제는 정상 처리됨 — 로컬 브랜치 잔존은 무해.

---

## 7. pre-push Hook 실패 — node --check SyntaxError

**증상**: `git push` 시 pre-push hook에서 SyntaxError로 차단

**원인**: `.githooks/pre-push`가 src/ 전체 .js에 `node --check` 실행

**해결책**:
```bash
node --check src/main/파일명.js   # 오류 파일 직접 확인 후 수정
```

---

## 8. Agent Worktree Isolation 실패

**증상**: `Agent` 도구에 `isolation: "worktree"` 사용 시 "not in a git repository" 오류

**원인**: 현재 워킹 디렉토리가 git 레포 루트가 아닌 경우 isolation 실패

**해결책**: `isolation: "worktree"` 제거. 에이전트 프롬프트에 레포 절대 경로 명시. 또는 메인 컨텍스트에서 직접 처리.

---

*새 문제 발생 시 위 형식으로 하단에 추가하세요: `## N. 제목`, 증상/원인/해결책*

## 9. PR 본문 이미지 깨짐 — raw.githubusercontent.com URL 소멸

**증상**: PR 본문의 스크린샷이 깨진 이미지로 표시됨

**원인**: feature 브랜치에 이미지를 커밋하고 `raw.githubusercontent.com/{owner}/{repo}/{feature-branch}/...` URL을 사용하면, 해당 브랜치가 merge 후 삭제될 때 URL도 함께 소멸함

**해결책**: 이미지는 삭제되지 않는 `develop` 브랜치에 커밋하고 URL도 develop 기준으로 사용
```bash
B64=$(base64 < screenshot.png | tr -d '\n')
gh api repos/{owner}/{repo}/contents/.github/screenshots/screenshot.png \
  --method PUT \
  --field message="chore: UI 스크린샷 추가" \
  --field content="$B64" \
  --field branch="develop"
# PR 본문 URL: https://raw.githubusercontent.com/{owner}/{repo}/develop/.github/screenshots/screenshot.png
```

---

*새 문제 발생 시 위 형식으로 하단에 추가하세요: `## N. 제목`, 증상/원인/해결책*
