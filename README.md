# Carbus · v3.0.0

CCC 광주지구의 행사 **참석 신청·차량 배정·현장 출석·수송·차량비 정산** 웹앱.
임역원이 캠퍼스 순장·순원의 정보를 대신 입력하고, 총단이 행사 전체를 운영하며,
차량순장이 배정된 호차의 탑승을 확인한다. 여러 행사의 자료를 행사별로 관리한다.

[운영 서비스](https://carbus-web.vercel.app) · [v3.0.0 릴리즈](https://github.com/Lumiere001/carbus-web/releases/tag/v3.0.0) · [전체 릴리즈](https://github.com/Lumiere001/carbus-web/releases)

## 역할과 진입 화면

| 사용자 | 인증·접근 조건 | 주요 업무 |
|---|---|---|
| 임역원 (`campus_admin`) | Google 로그인 후 총단이 캠퍼스 권한 부여 | 본인 캠퍼스 명단·참석·이동·납부 입력, 수송 요청, 송금 등록 (`/campus`) |
| 총단 (`master`) | 운영자 비밀번호 로그인 | 행사·권한·운행편·차량·배차·정산 관리 (`/admin`) |
| 조회 운영자 (`viewer`) | 운영자 비밀번호 로그인 | 전체 운영 자료 조회 (`/admin`) |
| 차량순장 | 로그인 계정에 총단이 담당 호차 지정 | 담당 호차의 상행·하행 탑승 확인 (`/driver`) |

차량순장 접근은 계정의 담당 호차 지정으로 관리한다. 신청 명단에 붙이는 역할 라벨과
계정의 접근 권한은 별개다. 순장·순원은 직접 신청하지 않으며 임역원이 대리 입력한다.
역할별 접근 범위는 서버 검증과 Supabase RLS로 제한한다.

## 현재 기능

| 업무 | 제공 기능 |
|---|---|
| 행사 운영 | 현재 행사 선택, 행사별 명단·차량·정산 조회, 운영 단계·활성 행사 관리 |
| 명단 | 검색·캠퍼스 필터, 추가·수정·제외, 인라인 편집과 상세 편집창, CSV 업로드·미리보기·내보내기 |
| 참석·이동 | 참여 예정 기간과 시각, 방향별 버스 편·이동수단, 부분 참석 화면에서 바로 수정 |
| 현장 기록 | **집회장 도착·집회장 떠남**, 반복 방문 기록, 사유를 남기는 정정, 서버 확인 시각 |
| 운행·배차 | 상행·하행 운행편과 차량 편성, 방향별 자동 배차, 수동 배정, 좌석·정원 조회 |
| 리더·간사 차량 | 캠퍼스·역할·미지정 필터와 검색, 방향별 차량순장·고정 탑승자 지정, 총단의 간사 차량 직접 배정·변경·해제 |
| 버스 출석 | 상행 탑승·하행 귀가 체크, 호차별 명단, 다른 기기의 변경 반영 |
| 수송·수강신청 | 선택 수송 요청·수강신청 입력, 날짜별 시간표, 같은 날짜·시각의 여러 사람 표시 |
| 정산 | 개인 납부·캠퍼스 송금·총단 확인 비교, 누적 장부, 면제자·차액 확인, 관련 변경 시각과 개인 활동 기록 대조 |
| 운영 진단 | 변경 내역·활동 기록·오류 점검, 저장 충돌 감지, 실패 후 복구 안내 |

자동 배차는 상행·하행을 독립적으로 계산하며, 운행편·차량 정원·차량순장·고정 탑승자와
기존 배정 규칙을 반영한다. 배차·리더·수동 배정·참석과 이동의 묶음 저장은
해당 RPC의 트랜잭션과 관측 값 비교로 정합성을 검사한다.
상세 정책은 [배차 설계](reference/batch_algorithm.md)와 구현·마이그레이션을 함께 확인한다.

### 참석 정보의 의미

- **참여 예정 일정**은 신청할 때 확정한 시작·종료 날짜와 시각이다.
- **집회장 도착·집회장 떠남**은 현장에서 체크한 실제 방문 기록이다. 예정 일정이나 버스 출석으로 추정하지 않는다.
- **상행 탑승·하행 귀가**는 차량 탑승 체크다. 집회장 방문 기록과 별개다.
- 부분 참석·편도 이용·우리 버스 외 이동이 포함된 신청은 예정 시작·종료 일시가 모두 확정되어야 한다. 버스를 이용하지 않는 방향도 이동수단을 명시해야 한다.
- 수송 요청과 수강신청은 선택 사항이다. 모든 날짜·시각의 표시·입력 기준은 한국 시간(KST, UTC+9)이다.

과거 자료의 비어 있는 시각은 자동으로 채우지 않는다. 새 등록과 참석·이동 변경에는
확정 일정 검증을 적용하고, 기존 자료의 관련 없는 이름·납부·출석 수정에는 소급 강제하지 않는다.

### 화면 주소

총단·조회 운영자의 업무 화면은 **`/admin/e/<eventId>/<업무>`** 형태다.
`/admin`은 활성 행사로 이동하며, 활성 행사가 없으면 최근 행사를 연다.
기존 `/admin/buses` 등의 알려진 옛 주소는 활성 행사의 해당 화면으로 연결한다.

| 영역 | 주소 |
|---|---|
| 운영 현황 | `/admin/e/<eventId>` |
| 명단·참여 | `/registrations`, `/partial`, `/leaders`, `/courses` — 행사 주소 뒤에 붙임 |
| 차량·이동 | `/buses`, `/attendance`, `/trips`, `/batch`, `/transport` — 행사 주소 뒤에 붙임 |
| 정산·운영 관리 | `/payments`, `/control`, `/users`, `/roles`, `/changes`, `/errors`, `/logs` — 행사 주소 뒤에 붙임 |
| 임역원 | `/campus`, `/campus/import`, `/campus/partial`, `/campus/buses`, `/campus/pickup`, `/campus/payments` |
| 차량순장 | `/driver` |
| 로그인 | `/login` (Google), `/admin/login` (운영자) |

## 기술 스택과 디자인

| 영역 | 사용 |
|---|---|
| 웹 | Next.js 16.2.6 (App Router) · React 19.2.4 · TypeScript |
| UI | Tailwind CSS v4 · 자체 공통 컴포넌트·디자인 토큰 · lucide-react · TanStack Table |
| 데이터 | Supabase PostgreSQL · Auth · RLS · Realtime · 트랜잭션 RPC |
| 입력·CSV | Zod · Papa Parse |
| 검증 | Vitest · Testing Library · Playwright · 로컬 PostgreSQL 통합 검증 |
| 배포 | Vercel · GitHub Actions의 타입·코드 검사·단위 테스트 |

x.ai의 어두운 흑백 표면·글자 위계·외곽선 버튼·간격을 업무 화면에 맞게 적용했다.
색은 납부·주의·오류 등 업무 상태에 사용한다. 표가 필요한 비교·편집은 유지하고,
시간표·호차·좌석·요약을 업무에 맞게 배치한다.

- [UI/UX 기준](DESIGN.md): 용어, 입력, 저장 피드백, 시간표, 밀도, 역할별 탐색.
- [안티패턴 기준](ANTI-PATTERNS.md): 정보 누락·중복, 잘못된 상태, 충돌·부분 저장, 행사·권한 범위.
- 공통 시각 토큰: [`app/globals.css`](app/globals.css). 현재 기본 테마는 어두운 화면이다.

## 로컬 개발

실행 가능한 **Node.js 20.9 이상**, **pnpm**을 준비한다. CI는 Node.js 22와 pnpm 10을 사용한다.
실제 로컬 DB·로그인·화면 검증에는 Docker와 실행 가능한 Supabase CLI도 필요하다.

### 평소 코드 검사 — Docker 불필요

```bash
pnpm install --frozen-lockfile
pnpm check           # 타입 → 코드 검사 → 단위 테스트, 실패하면 중단
```

각 검사를 따로 실행하려면 `pnpm typecheck`, `pnpm lint`, `pnpm test:run`을 사용한다.
`pnpm test`는 테스트를 변경 감시 모드로 실행한다.

### 기존 로컬 DB로 화면 확인

Docker가 실행 중인지 확인한 뒤, Carbus 로컬 DB가 꺼져 있을 때만 시작한다.

```bash
pnpm db:local        # Carbus 로컬 Supabase 시작, 기존 데이터 재사용
pnpm dev:local       # 로컬 DB 전용 앱: http://127.0.0.1:3010
```

앱은 Ctrl+C로 종료한다. DB도 필요 없으면 별도로 종료한다.

```bash
pnpm db:local:stop   # 로컬 데이터 볼륨을 보존하며 종료
```

`dev:local`은 DB를 자동 기동·초기화·적재하거나 마이그레이션·계정 생성을 실행하지 않는다.
이미 실행 중인 로컬 스택을 읽고, 포트 점유·잘못된 Node·원격 DB 주소를 검사한다.
필요할 때 `PORT=3012 pnpm dev:local`처럼 포트만 바꿀 수 있다.

**기존 `.env.local`이 운영 DB를 가리킬 수 있으므로 로컬 실험에는 `pnpm dev:local`을 사용한다.**
일반 `pnpm dev`는 `.env.local`의 연결 설정으로 실행된다. 같은 작업 폴더에서 앱을 중복 실행하거나
운영·로컬 빌드를 같은 `.next`에 섞지 않는다.

가벼운 로컬 구성은 PostgreSQL·Auth·REST·Kong·Realtime을 유지한다.
최초 DB 구성·로컬 계정 생성·마이그레이션 검증은 별도 작업이다.
[로컬 개발 안내](LOCAL-DEVELOPMENT.md)와 [DB 검증 절차](scripts/local-verify/README.md)를 확인한다.
일상적인 화면 작업마다 DB를 리셋하거나 운영 백업을 다시 적재하지 않는다.

### 환경변수와 빌드

처음 환경을 구성할 때 [`.env.local.example`](.env.local.example)을 복사하고 **해당 환경의** 값을 입력한다.
운영 환경은 Vercel에 별도로 등록한다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_VIEWER_EMAIL=
ADMIN_MASTER_EMAIL=
```

서비스 역할 키는 서버 전용이다. 실제 환경 파일·백업·로그인 정보·실명이 포함된 검증 자료는 커밋하지 않는다.
Supabase의 Google OAuth와 운영자 계정·프로필 권한도 환경별로 구성해야 한다.

```bash
pnpm build           # 연결 환경과 NEXT_PUBLIC_* 값을 준비한 뒤 빌드
pnpm start           # 해당 빌드 실행
```

`NEXT_PUBLIC_*` 값은 빌드에 포함되므로 로컬 검토 빌드와 운영 빌드의 연결 환경을 각각 확인한다.

## 검증과 운영

- `pnpm check`: Docker 없이 타입·코드 검사·Vitest 테스트를 실행한다.
- `bash scripts/local-verify/dev-local.test.sh`: 실제 DB나 앱을 켜지 않고 로컬 실행 보호를 검사한다.
- `tests/integration/*.sql` 및 동시성 검증 스크립트: 별도의 로컬 PostgreSQL 환경이 필요하다. `pnpm check`가 이 SQL 검증까지 실행하는 것은 아니다.
- `pnpm test:e2e`: Playwright 검증. 현재 설정은 3000번 포트에서 일반 개발 서버를 기동하거나 재사용하므로, 실행 전에 테스트 전용 DB 환경을 확인한다. CI의 E2E 단계는 현재 비활성이다.
- DB 변경: 기존 자료 백업 → 로컬 마이그레이션·권한·정합성 검증 → 적용 범위 확인 → 운영 적용·자료 보존 대조 → 앱 배포·업무 확인 순서로 진행한다.

### 원격 DB가 일시 정지되는 경우

Supabase 무료 플랜은 **최근 7일간 DB 활동이 적으면 자동 일시 정지될 수 있다**.
공식 안내에서는 보통 지난 일주일 동안 매일 몇 차례의 사용자 DB 요청이면 정지를 피할 수 있다고 설명한다.
무료 플랜을 유지한다면 매일 명단·현황 등 실제 DB를 읽는 화면을 확인하는 방식이 적합하다.
단순 정적 홈 페이지 접속이나 며칠에 한 번의 요청만으로 계속 켜져 있음을 보장할 수는 없다.

이미 정지된 프로젝트는 Supabase Dashboard에서 **Resume project**로 복구한다.
상시 운영이 필요하면 유휴 정지 대상이 아닌 유료 플랜을 검토한다.
[Supabase 공식 일시 정지 안내](https://supabase.com/docs/guides/platform/free-project-pausing).

Vercel의 함수는 요청이 들어오면 자동 실행되므로 별도의 정기 수동 깨우기 일정이 필요하지 않다.
[Vercel 함수 실행 방식](https://vercel.com/docs/functions#how-the-vercel-functions-lifecycle-works).

## 프로젝트 구조

```text
app/                   # campus·driver·행사별 admin 화면, 서버 동작·API
components/
  ui/                  # 버튼·입력·대화상자·공통 업무 골격
  admin/ campus/       # 역할별 업무 패널
  registrations/       # 신청·참석·이동 입력과 공용 편집
  onsite/ attendance/  # 집회장 실제 방문과 차량 출석
  schedule/ pickup/    # 날짜별 시간표와 수송 요청
lib/
  batch/               # 순수 함수 배차 엔진
  events/              # 행사 범위·주소
  registrations/       # 신청·참석 예정·여정 검증과 저장
  onsite/ payments/    # 현장 상태·정산 변경 이력
  admin/ campus/       # 업무별 데이터 동작
  supabase/            # 클라이언트·서버·DB 타입
  validators/ csv/     # 입력 검증·CSV 처리
supabase/migrations/   # 스키마·뷰·RLS·트리거·RPC
scripts/local-verify/  # 로컬 실행·백업·마이그레이션 검증
tests/                 # 단위·DB 통합·브라우저 검증
reference/             # 배차·데이터·정산 등의 설계 참고
.github/workflows/     # 자동 코드 검사
```

## 릴리즈 기록

### v3.0.0 — 행사 운영 UI/UX와 업무 연결 개선

- 역할별 업무 메뉴·검색, 공통 흑백 디자인, 정보량에 맞는 화면 배치.
- 확정 참석 예정 일시·방향별 이동수단 입력, 같은 화면에서 부분 참석 수정.
- 집회장 실제 방문·정정 기록과 차량 출석 분리, 묶음 저장·충돌·권한 검증.
- 수강신청·수송 요청의 날짜별 시간표, 겹치는 신청과 전체 메모 보존.
- 정산 관련 변경 시각·활동 기록 연결, 운행편 입력 높이 정렬.
- 리더 목록 정렬·검색·필터, 총단의 간사 차량 고정 탑승자 직접 배정.
- Docker 없이 일상 코드 검사, 기존 로컬 DB 재사용과 명시적인 기동·종료.

전체 변경과 검증 범위는 [v3.0.0 릴리즈](https://github.com/Lumiere001/carbus-web/releases/tag/v3.0.0)를 확인한다.

### 이전 주요 릴리즈

- **v1.1.1**: 고정 요일 대신 데이터 기반 출발 슬롯, 배차·CSV·화면의 슬롯 모델 통일.
- **v1.1.0**: 역할 기반 차량순장·고정 탑승 관리, 전체 명단 수정, 부분 참석 조회.
- **v1.0.0**: 캠퍼스 신청·CSV·충돌 방지, 방향별 배차, 호차 운영, 차량비 정산, 인증·RLS.

## 라이선스

[GNU AGPL-3.0](LICENSE). 다른 교회·지구가 사용·수정·재배포할 수 있다.
수정한 버전을 네트워크 서비스로 제공하는 경우에는 라이선스의 소스 제공 의무를 따른다.
