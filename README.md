# carbus-web

CCC 71기 광주지구 여름수련회 **차량 신청·배차·정산 웹앱**.
임역원이 순장/순원 명단을 입력하면, 운영자가 자동 배차하고 차량비를 3중 비교로 정산한다.

> 광주 → 평창, 약 500명, 9대 운영. 노션 + Python 스크립트로 운영하던 것을 자체 웹앱으로 재구축.

## 기능

- **인증·권한** — Google OAuth(임역원·게스트) + 운영자 비밀번호 계정(viewer/master). Supabase RLS로 역할별 데이터 접근 제어.
- **순장/순원 입력** (`/campus`) — TanStack Table 인라인 편집 grid. 셀 단위 충돌 감지 + Supabase Realtime 동기화.
- **대량 등록** (`/campus/import`) — CSV 업로드 + 표 복사·붙여넣기. 한글 헤더 자동 매핑·미리보기.
- **운영 대시보드** (`/admin`) — 캠퍼스별·일자별·호차별·정산·헬스 위젯.
- **자동 배차** (`/admin/batch`) — 6단계 Bin Packing(같은 캠퍼스 묶음·요일 분리·고정 배정 보존). 순수 함수 엔진 + 단위 테스트.
- **호차 관리** (`/admin/buses`) — 9대 카드, 차량순장·고정 탑승자 지정, 좌석 시각화. 모바일 조회(`/campus/buses`).
- **차량비 정산** (`/admin/payments`·`/campus/payments`) — 시스템 완납 ↔ 캠퍼스 송금 ↔ 운영자 입금 3중 비교.
- **로그·오류** — 모든 변경은 audit 트리거로 자동 기록. 배차 실패 이력 추적.

## 기술 스택

| 영역 | 사용 |
|---|---|
| Frontend | Next.js (App Router) · React · TypeScript (strict) |
| UI | Tailwind CSS v4 + 자체 디자인 토큰 · cva 컴포넌트 · lucide-react |
| 데이터 | Supabase (PostgreSQL · Auth · RLS · Realtime) |
| 폼·CSV | Zod · papaparse |
| 테스트 | Vitest (단위) · Playwright (E2E) |
| 배포 | Vercel |

## 시작하기

```bash
pnpm install

# 환경변수 — .env.local.example 복사 후 Supabase·OAuth 값 채우기
cp .env.local.example .env.local

pnpm dev          # 개발 서버 (localhost:3000)
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
pnpm test:run     # 단위 테스트
pnpm build        # 프로덕션 빌드
```

### Supabase 셋업

1. Supabase 프로젝트 생성 후 `SUPABASE_URL`·`SUPABASE_ANON_KEY`를 `.env.local`에 입력.
2. `supabase/migrations/`의 SQL을 순서대로 적용 (SQL Editor 또는 Supabase CLI).
3. Google OAuth provider 등록 + 운영자 계정 생성 후 `profiles.role` 매핑(초기 스키마 §9 참고 — 환경별 UID는 직접 입력).

## 프로젝트 구조

```
app/                 # Next.js 라우트 (campus/* 임역원, admin/* 운영자)
components/
  ui/                # 디자인 시스템 (button·badge·card)
  campus/ admin/     # 화면별 패널
lib/
  batch/             # 배차 엔진 (순수 함수)
  supabase/          # 클라이언트·서버·타입
  validators/ csv/   # Zod 검증 · CSV 파서
supabase/migrations/ # PostgreSQL 스키마·뷰·RLS·트리거
reference/           # 설계 문서 (스키마·알고리즘·정산 흐름·테스트)
```

## 문서

- `SPEC.md` — 시스템 명세 (single source of truth)
- `reference/` — DB DDL · 배차 알고리즘 · 검증 규칙 · 차량비 흐름 · 테스트 시나리오

## 라이선스

비공개 사역 도구. 별도 라이선스 미지정.
