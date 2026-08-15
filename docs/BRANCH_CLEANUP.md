# 브랜치 및 이슈 정리 가이드

## 원칙

- feature 브랜치는 develop에 머지 직후 삭제
- 이슈는 PR 머지 시 `Closes #N` 키워드로 자동 닫힘 (PR 템플릿에 포함)
- 주기적으로 원격에 남은 고아 브랜치를 일괄 정리

## 머지 후 자동 정리

`gh pr merge --squash --delete-branch` 플래그로 PR 머지 시 원격 브랜치 자동 삭제.
PR 본문에 `Closes #N` 포함 시 이슈도 자동 닫힘.

## 수동 정리 (고아 브랜치)

```bash
# 원격에 남은 머지 완료 브랜치 확인
git fetch --prune
git branch -r | grep feature/

# 개별 삭제
git push origin --delete feature/issue-N-설명

# 일괄 삭제 (develop에 머지된 것만)
git fetch origin
for branch in $(git branch -r | grep origin/feature/ | sed 's|origin/||'); do
  git push origin --delete "$branch" 2>/dev/null && echo "deleted $branch"
done

# 로컬 고아 브랜치 정리
git remote prune origin
git branch --merged develop | grep -v "^\*\|main\|develop" | xargs git branch -d
```

## 이슈 수동 닫기

```bash
# 여러 이슈 일괄 닫기
for n in 9 10 11 12 13 14; do
  gh issue close $n --reason completed
done
```

## 정리 이력

| 날짜 | 삭제 브랜치 | 닫힌 이슈 |
|------|------------|----------|
| 2026-08-16 | feature/issue-1~4, 9~14, 21~24 | #9~14, #21~24 |
