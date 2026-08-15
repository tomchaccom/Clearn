# AGENT.md — Clearn

Codex CLI 및 기타 AI 에이전트가 이 레포에서 작업할 때 참조하는 문서.
Claude Code 사용자는 `CLAUDE.md`를 참조하세요.

## 공통 문서 참조
- `.claude/project-context.md` — 아키텍처, 도메인 모델, 데이터 플로우
- `CONTRIBUTING.md` — 브랜치 전략, 커밋 규칙, PR 프로세스
- `CLAUDE.md` — 핵심 파일 목록, IPC 규칙, 빌드 명령

## 프로젝트 개요
**Clearn** — Electron 기반 학습 앱.
소크라테스식 AI 튜터 · 인출 연습(SM-2 SRS) · 자기설명 검증 · 망각 곡선 기반 복습.
로컬 Claude Code 구독으로 동작 (API 키 불필요, `@anthropic-ai/claude-agent-sdk` 사용).

## 기술 스택
- Electron 33 (Node.js 22 기반)
- Vanilla JS (프레임워크 없음)
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- SM-2 Spaced Repetition (store.js)
- electron-builder (.dmg 빌드)

## 주요 파일 (수정 시 읽어야 할 것)

| 수정 대상 | 읽어야 할 파일 |
|-----------|--------------|
| AI 동작 변경 | `src/main/prompts.js` |
| 새 IPC 채널 | `src/main/main.js` + `src/main/preload.cjs` |
| 데이터 구조 | `src/main/store.js` |
| UI 변경 | `src/renderer/app.js` + `src/renderer/index.html` |
| Obsidian 연동 | `src/main/obsidian.js` |

## 작업 규칙
1. IPC: preload.cjs를 통해서만 노출 (contextIsolation: true)
2. 렌더러: Node.js API 직접 사용 금지
3. 데이터: store.js를 통해서만 읽기/쓰기
4. 프롬프트: prompts.js에 추가 후 main.js에서 import

## 브랜치 전략
```
main (릴리즈) <- develop (통합) <- feature/issue-{N}-{설명}
```

## 커밋 형식
```
feat(scope): 내용
fix(scope): 내용
docs(scope): 내용
chore(scope): 내용
```

## 빌드
```bash
npm start    # 개발
npm test     # 테스트
npm run dist # .dmg 빌드
```
