## 변경 사항

<!-- 한 줄 요약: 이 릴리즈에서 무엇이 달라졌는지 -->

### 새 기능
-

### 버그 수정
-

### 기타
-

---

## 설치

1. 아래 `Clearn-{version}-arm64.dmg` 다운로드
2. 기존 앱이 있으면 `/Applications/Clearn.app` 삭제 후 교체
3. Gatekeeper 경고 시 터미널에서:
   ```
   xattr -dr com.apple.quarantine /Applications/Clearn.app
   ```

## 요구사항

- macOS 12 이상 (Apple Silicon 권장)
- [Claude Code](https://claude.ai/code) 설치 및 `claude` 로그인 완료
