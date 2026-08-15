# CLAUDE.md — Clearn

Claude Code가 이 레포에서 작업할 때 따르는 규칙.

## 실행 중 문제 발생 시

`docs/TROUBLESHOOTING.md`를 먼저 확인하세요.
- 해결책이 있으면 그대로 조치
- 없으면 조치 후 TROUBLESHOOTING.md 하단에 새 항목 추가 (증상·원인·해결책 형식)

## 프로젝트 개요
→ `.claude/project-context.md` 참조 (아키텍처·도메인 모델·데이터 플로우)

Clearn은 소크라테스식 튜터 + 인출 연습 + 자기설명 검증을 제공하는 Electron 학습 앱.
로컬 Claude Code 구독으로 AI 기능 동작 (API 키 불필요).

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/main/main.js` | IPC 핸들러 전체, 알림 스케줄러 |
| `src/main/store.js` | JSON 영속성, SM-2 SRS |
| `src/main/agent.js` | Claude Agent SDK 래퍼 (`run`, `runJson`) |
| `src/main/prompts.js` | 레버 1~4 프롬프트 모음 — 튜닝은 여기서 |
| `src/main/obsidian.js` | Obsidian 보관함 내보내기 |
| `src/main/preload.cjs` | contextBridge IPC bridge |
| `src/renderer/app.js` | 렌더러 전체 로직 (Vanilla JS) |
| `src/renderer/index.html` | UI 진입점 |
| `src/renderer/styles.css` | 다크 테마, CSS 변수 기반 |

## 아키텍처 규칙
1. IPC는 반드시 `preload.cjs`의 `contextBridge`를 통해서만 노출
2. 렌더러에서 Node.js API 직접 사용 금지
3. 데이터 읽기/쓰기는 `store.js`를 통해서만
4. 새 프롬프트는 `prompts.js`에 추가 후 `main.js`에서 import

## 작업 흐름 (빠른 요약)
→ `CONTRIBUTING.md` 및 `.claude/commands/dev.md` 참조

```
GitHub 이슈 생성
→ git checkout develop && git checkout -b feature/issue-{N}-{설명}
→ 코드 변경
→ git push → PR (develop 대상)
→ 머지 후 develop→main PR로 릴리즈
```

## 커밋 형식
한국어 Conventional Commits with scope:
```
feat(tutor): 소크라테스 모드 힌트 횟수 제한 추가
fix(store): 카드 삭제 시 인덱스 오류 수정
docs(readme): 설치 방법 보완
```

## 커스텀 스킬
- `/dev` — 이슈→브랜치→PR→배포 전체 플로우
- `/update-context` — `.claude/project-context.md` 갱신

## MCP 서버
→ `.claude/mcp-guide.md` 참조
- GitHub MCP: 이슈/PR 관리
- Filesystem MCP: 파일 직접 접근

## 브랜치 보호
- `main`: develop PR 통해서만 (직접 커밋 금지)
- `develop`: feature/fix 브랜치에서 PR로만

## 빌드 / 실행
```bash
npm start       # 개발 모드 (Electron 직접 실행)
npm test        # 단위 + 통합 테스트 (모델 호출 없음)
npm run dist    # .dmg 빌드 → dist/
```

## 메모리
`.claude/memory/MEMORY.md` — 세션 간 지속 컨텍스트
