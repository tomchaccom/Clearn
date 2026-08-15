# 프로젝트 온톨로지 갱신

이 스킬이 실행되면 `.claude/project-context.md`를 현재 코드 상태에 맞게 최신화한다.

추가 컨텍스트: $ARGUMENTS

## 갱신 절차

### 1단계: 현재 상태 파악

아래 파일들을 읽어 현재 상태를 확인한다:
- `package.json` — 버전, 의존성 변경 확인
- `src/main/main.js` — 새로 추가/제거된 IPC 핸들러 확인
- `src/main/store.js` — 스키마 버전, EMPTY 설정 변경 확인
- `src/main/preload.cjs` — 노출된 IPC 목록 확인
- `src/renderer/index.html` — 새 탭/뷰/모달 추가 여부
- `CONTRIBUTING.md` — 워크플로우 변경 여부
- `git log --oneline -10` — 최근 커밋으로 변경 이력 파악

### 2단계: 변경 사항 식별

현재 `project-context.md`와 비교해서 달라진 것을 목록으로 정리한다:
- 새로 추가된 기능/파일
- 제거되거나 변경된 IPC 채널
- 데이터 스키마 변경
- 해결된 이슈, 새로 열린 이슈
- 기술 스택 변경 (의존성 추가/제거)

### 3단계: project-context.md 갱신

변경된 섹션만 수정한다. 반드시 지킬 것:
- 맨 위 `_마지막 갱신:` 날짜를 오늘 날짜로 업데이트
- "다음 세션을 위한 힌트" 섹션에 현재 진행 중인 작업/이슈 반영
- "현재 상태 & 제한사항"에 완료된 것 이동, 새 제한 추가
- IPC 채널 목록 동기화

### 4단계: 커밋 (선택)

`$ARGUMENTS`에 "커밋" 또는 "commit"이 포함된 경우:
```bash
git add .claude/project-context.md
git commit -m "docs(context): 프로젝트 온톨로지 갱신

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## 갱신 주기 권고

- 새 기능 추가 후
- 이슈 완료 후 (PR merge 직전 또는 직후)
- 새 세션 시작 전 (이전 세션 작업 내용 반영)
