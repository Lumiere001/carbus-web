# carbus-web

CCC 광주지구 여름수련회 **차량 신청·배차·정산 웹앱**.
임역원이 순장/순원 명단을 입력하면, 운영자가 호차를 자동 배차하고 차량비를 정산한다.

> 광주 → 평창, 약 500명, 9대 운영(1~7호차 화요일 / 8~9호차 수요일 출발).
> 노션 + Python 스크립트로 운영하던 것을 자체 웹앱으로 재구축.

## 역할

| 역할 | 인증 | 하는 일 |
|---|---|---|
| 임역원 (campus_admin) | Google OAuth + 총단이 캠퍼스 부여 | 본인 캠퍼스 순장/순원 입력·납부·송금 등록 |
| 운영자 viewer | 비밀번호 | 전체 현황 보기 |
| 운영자 master (총단) | 비밀번호 | 권한 관리·배차·정산·시스템 설정 |

순장/순원(학우)은 시스템에 접근하지 않으며, 임역원이 대신 입력한다.

## 기능

- **인증·권한** — Google OAuth(임역원) + 운영자 비밀번호 계정(viewer/master). Supabase RLS로 역할별 데이터 접근 제어.
- **순장/순원 입력** (`/campus`) — TanStack Table 인라인 편집 grid. 셀 단위 충돌 감지 + Supabase Realtime 동기화.
- **대량 등록** (`/campus/import`) — CSV 업로드. 한글 헤더 자동 매핑·미리보기·실패 행 표시.
- **자동 배차** (`/admin/batch`) — **상행·하행을 각각 따로 실행.** 호차를 정원(44)까지 꽉 채워 미배정을 최소화하고, 같은 캠퍼스는 되도록 같은 호차로 묶는다. 요일 분리, 차량순장·고정 탑승자 고정 배정 보존. 순수 함수 엔진 + 단위 테스트. 배차 후 master가 미배정 인원을 직접 호차 배정.
- **호차 관리** (`/admin/buses`) — 9대 카드(상행/하행 보기 토글), 차량순장·고정 탑승자 지정, 좌석 시각화. 임역원 모바일 조회(`/campus/buses`)는 상행·하행·대기 분리.
- **전체 명단** (`/admin/registrations`) — 캠퍼스별 묶음 + 이름·학번 검색 + 미납→완납→면제 정렬. master는 호차 재배정·역할 라벨 부여·명단 제외.
- **차량비 정산** — 임역원(`/campus/payments`)은 걷어야 할/걷힌/총단 송금 누계/보유 잔액 + 송금 내역(누적 원장). 운영자(`/admin/payments`)는 시스템 완납 ↔ 캠퍼스 송금 ↔ 총단 입금 3중 비교 + 캠퍼스 완납 표시 + 면제자 명단.
- **운영 대시보드** (`/admin`) — 캠퍼스별·일자별 정원·호차별 상/하행 탑승·정산·헬스 위젯.
- **로그·오류** (`/admin/logs`·`/admin/errors`) — 모든 변경은 audit 트리거로 자동 기록. 배차 실패 이력 추적.

## 기술 스택

| 영역 | 사용 |
|---|---|
| Frontend | Next.js (App Router) · React · TypeScript (strict) |
| UI | Tailwind CSS v4 + 자체 디자인 토큰 · cva · lucide-react |
| 데이터 | Supabase (PostgreSQL · Auth · RLS · Realtime) |
| 폼·CSV | Zod · papaparse |
| 테스트 | Vitest (단위) · Playwright (E2E) |
| 배포 | Vercel |

## 시작하기

```bash
pnpm install
cp .env.local.example .env.local   # Supabase·운영자 계정 값 채우기

pnpm dev          # 개발 서버 (localhost:3000)
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
pnpm test:run     # 단위 테스트
pnpm build        # 프로덕션 빌드
```

### 환경변수 (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_VIEWER_EMAIL=
ADMIN_MASTER_EMAIL=
```

### Supabase 셋업

1. Supabase 프로젝트 생성 → 위 URL·키를 `.env.local`에 입력.
2. `supabase/migrations/`의 SQL을 파일명 순서대로 적용 (SQL Editor 또는 Supabase CLI).
3. Google OAuth provider 등록 + 운영자 계정 2개 생성 후 `profiles.role`을 `viewer`/`master`로 매핑 (초기 스키마의 운영자 매핑 블록 참고 — UID는 환경별로 입력).

## 프로젝트 구조

```
app/                 # Next.js 라우트 (campus/* 임역원, admin/* 운영자)
components/
  ui/                # 디자인 시스템 (button·badge·card)
  campus/ admin/     # 화면별 패널
lib/
  batch/             # 배차 엔진 (순수 함수 + mode: 상행/하행)
  supabase/          # 클라이언트·서버·타입
  validators/ csv/   # Zod 검증 · CSV 파서
supabase/migrations/ # PostgreSQL 스키마·뷰·RLS·트리거·RPC
reference/           # 설계 문서 (스키마·알고리즘·정산 흐름·테스트)
```

## 배차 알고리즘 (요약)

상행·하행을 **독립적으로** 계산한다. 우선순위:

1. **미배정 최소화** — 정원이 허용하는 한 전원 배정.
2. **호차 꽉 채움(정원 44)** — 보조석(45)은 부족할 때만.
3. **같은 캠퍼스 묶음** — 안 되면 찢어서라도 채움(1명만 떨어지지 않게).
4. (상행) 요일 분리 + 차량순장·고정 탑승자 보존.

자세한 내용: `reference/batch_algorithm.md`, `SPEC.md`.

## 릴리스 (Changelog)

> 자세한 내용은 [GitHub Releases](https://github.com/Lumiere001/carbus-web/releases) 참고.

### v1.1.1 — 출발 슬롯 모델 (요일 → 데이터 일반화)
- 상행 출발을 고정 enum(화/수)에서 **`departure_slots` 데이터 테이블**로 일반화.
  출발 시간대(예: 화 오전 9시 / 화 오후 7시)를 행으로 관리하며, 슬롯·버스 추가가
  코드 변경 없이 행 추가만으로 반영됨.
- 배차 엔진·프리셋·검증·CSV·전 화면이 슬롯 기준으로 동작. 하행은 종전대로 슬롯 무관.
- 마이그레이션 `20260522090000_departure_slots`: 기존 화→화오전, 수→화오후 매핑.

### v1.1.0 — 역할 기반 리더 관리 · 명단 관리 (범용)
- **역할 기반 차량순장/고정탑승**: 순장/순원에게 역할을 부여하면 현재 배정 호차에 자동
  결박(호차 바인딩이 단일 진실원). `리더 관리`(/admin/leaders)에서 상·하행 호차 지정,
  미지정 리더가 있으면 배차 차단.
- **명단 관리(master)**: 순장/순원 추가 + 이름·학번·참석일정·납부·캠퍼스·비고 수정.
- **부분 참석자**: 편도(상행만/하행만) 모아보기 + 비고(평창역 일정 등 자유 기록).
- **마감 후 변동 모니터**: 마감(phase2) 이후 추가·수정·제외 + 배차 상태 점검.
- 학번 표기 정리(두 자리 / 외국인 / 타지구).

### v1.0.0 — 최초 정식 출시
- 신청·관리(캠퍼스 그리드·CSV 임포트·동시편집 충돌 방지), 배차 엔진(FFD, 상·하행 독립,
  차량순장·고정 보존), 호차 운영, 차량비 3중 대조 정산, 운영자 도구(대시보드·단계 전환·로그).
- 인증(Google OAuth + 운영자), Supabase RLS 캠퍼스 분리.

## 라이선스

[GNU AGPL-3.0](./LICENSE) — 자유롭게 사용·수정·재배포할 수 있으나, 수정한 버전을
네트워크 서비스로 제공할 경우 그 소스도 공개해야 합니다. 다른 교회·지구가 갖다 쓸 수
있도록 공개합니다.
