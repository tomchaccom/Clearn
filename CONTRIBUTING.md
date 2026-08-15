# Contributing to Clearn

## Git Flow 전략

```
main        ──── 프로덕션 (릴리즈 태그)
  └─ develop ──── 통합 개발
       └─ feature/issue-{번호}-{설명}   새 기능
       └─ fix/issue-{번호}-{설명}       버그 수정
```

- **main**: 릴리즈 전용. 직접 커밋 금지. develop → main PR로만 반영.
- **develop**: 모든 작업의 기준 브랜치. 여기서 분기, 여기로 머지.
- **feature/fix 브랜치**: 이슈 1개 = 브랜치 1개.

## 작업 흐름

1. GitHub에서 이슈 생성
2. develop 기준으로 브랜치 생성
   ```bash
   git checkout develop && git pull
   git checkout -b feature/issue-{번호}-{짧은-설명}
   ```
3. 작업 후 커밋 (아래 커밋 규칙 참고)
4. PR 생성 → develop 대상
5. 리뷰 후 Squash merge
6. develop → main PR 생성 후 merge → 자동 빌드 + 릴리즈

## 브랜치 이름 규칙

| 종류 | 형식 | 예시 |
|------|------|------|
| 기능 | `feature/issue-{번호}-{설명}` | `feature/issue-12-dark-mode` |
| 버그 | `fix/issue-{번호}-{설명}` | `fix/issue-15-crash-on-start` |
| 릴리즈 | `release/v{버전}` | `release/v1.2.0` |

## 커밋 메시지 규칙

한국어 Conventional Commits 형식을 따른다.

```
feat(tutor): 소크라테스 모드 힌트 횟수 제한 추가
fix(session): 세션 복원 실패 시 크래시 수정
chore(deps): electron 33.4.11로 업데이트
docs(readme): README 설치 방법 보완
```

- 제목은 50자 이내
- 본문이 필요하면 빈 줄 하나 후 작성

## PR 규칙

- **대상 브랜치**: develop (main 직접 PR 금지)
- **제목**: `[#이슈번호] 작업 내용 한 줄 요약`
- **본문**: PR 템플릿 필수 작성
- UI 변경이 있으면 스크린샷 첨부

## 릴리즈 프로세스

1. develop → main PR 생성
2. PR merge
3. GitHub Actions가 자동으로 빌드 + 릴리즈 생성
4. 릴리즈 노트에 변경사항 상세 기술 (Actions가 draft 생성, 수동으로 보완 후 publish)
