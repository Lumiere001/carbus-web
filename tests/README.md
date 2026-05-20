# 테스트 가이드

자동 테스트 — Vitest (단위·통합) + Playwright (E2E).

## 실행

```bash
# 단위 + 통합 (watch)
pnpm test

# 단위 + 통합 (1회)
pnpm test:run

# E2E (Playwright, dev server 자동 기동)
pnpm test:e2e

# E2E + UI 모드
pnpm test:e2e --ui
```

## 폴더 구조

```
tests/
├── setup.ts            # Vitest 전역 setup (jest-dom)
├── unit/               # 단위 — lib/* 함수
├── integration/        # Supabase 로컬 + RLS 테스트
└── e2e/                # Playwright — 사용자 흐름
```

## Phase별 게이트

자세한 시나리오는 `reference/test_scenarios.md` 참고.

### Phase A (현재)
- [x] sanity 테스트 (Vitest)
- [x] 홈 + 로그인 페이지 렌더 (Playwright)
- [x] 미인증 redirect (Playwright)
- [ ] RLS 통합 테스트 (Supabase 마이그 적용 후)
- [ ] Google OAuth E2E (실제 OAuth는 manual 또는 mock)
- [ ] 운영자 비번 로그인 E2E (실 DB 필요)

### Phase B~F
- Phase B 진입 시 `tests/unit/validators.test.ts`, `tests/unit/batch.test.ts` 작성
- Phase E 진입 시 배차 시나리오 10+

## CI

GitHub Actions yml은 Phase A 끝 무렵 추가.
