import type { Database } from "@/lib/supabase/database.types";

export type TransportMode = Database["public"]["Enums"]["transport_mode"];
export type TransportStatus = Database["public"]["Enums"]["transport_status"];

/**
 * 이동수단 표시 (3단계 — 비고 구조화).
 *
 * 왜 구조로 받는가: 지난 수련회 비고에서 **"타지구"가 정반대 두 뜻**으로 쓰였다.
 * 소속이 타지구(63건) / 타지구 *차량*을 얻어 탐(80건). 문자열로는 구분이 안 된다.
 * 소속은 `home_unit_id` 가, 이용수단은 `transport_legs` 가 담당한다.
 */
export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  our_bus: "우리 버스",
  other_district: "타지구 차량",
  ktx: "KTX·고속버스",
  own_car: "자차·가족차",
  other: "기타",
};

/** 선택지 순서 — 흔한 것부터. 임역원이 매번 훑어야 하는 목록이다. */
export const TRANSPORT_MODES: TransportMode[] = [
  "our_bus",
  "other_district",
  "ktx",
  "own_car",
  "other",
];

/**
 * 배지 문구.
 *
 * ⚠️ **줄이지 않는다.** `KTX·고속버스` 를 `KTX` 로 줄였더니 고속버스로 오는 사람이
 * 배지에서 사라졌다 — 현장에서는 둘이 전혀 다른 교통편인데 화면만 보면 전원이
 * KTX 로 읽힌다. `자차·가족차` 도 같다(본인 차와 가족이 태워다 주는 건 다르다).
 * 한 칸에 안 들어가는 것보다 잘못 읽히는 게 훨씬 비싸다.
 */
export const TRANSPORT_SHORT: Record<TransportMode, string> = {
  our_bus: "버스",
  other_district: "타지구",
  ktx: "KTX·고속버스",
  own_car: "자차·가족차",
  other: "기타",
};

// ── 방향 문구 (한 곳에서만 만든다) ──────────────────────────────
//
// "갈 때 / 올 때" 는 사람마다 기준이 달라서 헷갈린다 — 집에서 가는 건지, 행사장에서
// 오는 건지. 그래서 **어디서 어디로 가는지**로 적는다. 수송 요청은 §23-A 에서 이미
// 그렇게 바꿨는데 이동수단만 "갈 때 (상행)" 으로 남아 문구가 따로 놀았다.
//
// 도착지는 **지명이 아니라 "수련회장"** 이다. 행사 설정의 목적지(예: 평창)를 쓰면
// 픽업 장소도 지명이라 "평창역 → 평창" 처럼 읽혀 오히려 헷갈린다.

export type LegDirection = "up" | "down";

/** 이동수단 — 사람은 자기 지구에서 출발한다. */
export const DIRECTION_LABELS: Record<LegDirection, string> = {
  up: "지구 → 수련회장",
  down: "수련회장 → 지구",
};

/** 수송 요청 — 따로 데리러 가는 장소가 출발지다. */
export const PICKUP_DIRECTION_LABELS: Record<LegDirection, string> = {
  up: "픽업 장소 → 수련회장",
  down: "수련회장 → 픽업 장소",
};

/**
 * 배지·표 한 칸처럼 **자리가 없을 때만** 쓰는 짧은 형태.
 * 긴 문구를 title 로 함께 달아 준다 — 짧은 쪽만 남으면 다시 헷갈린다.
 */
export const DIRECTION_SHORT: Record<LegDirection, string> = {
  up: "가는 편",
  down: "오는 편",
};

/**
 * 이 이동수단이면 우리 버스 좌석을 잡고 있을 이유가 없다 (§26-B).
 *
 * ⚠️ DB 의 `public.leg_skips_our_bus` 와 **같은 술어여야 한다.** 화면이 더 느슨하면
 * 확인창 없이 좌석이 사라지고, 더 엄격하면 아무 일도 안 일어나는데 경고만 뜬다.
 *
 * 타지구 "확정 대기" 만 예외다 — 무산되면 바로 타야 하므로 자리를 잡아둔다.
 */
export function legSkipsOurBus(
  mode: TransportMode,
  status: TransportStatus
): boolean {
  if (mode === "our_bus") return false;
  if (mode === "other_district") return status === "confirmed";
  return true; // ktx · own_car · other
}

export type BadgeTone = "mute" | "primary" | "warning" | "success" | "danger";

/**
 * 한 방향의 이동수단을 배지 하나로.
 *
 * "확정 대기"는 색으로 구분한다 — 피드백의 핵심이 **"확정이 날 때까지 기다리는
 * 경우가 많고 그걸 한눈에 보고 싶다"** 였다. 목록을 읽어 내려가며 세는 게 아니라
 * 색으로 걸러져야 한다.
 */
export function transportBadge(
  mode: TransportMode | null | undefined,
  status: TransportStatus | null | undefined,
  viaUnit?: string | null
): { text: string; tone: BadgeTone; title: string } | null {
  if (!mode || mode === "our_bus") return null; // 기본값은 표시하지 않는다 (소음)

  const short = TRANSPORT_SHORT[mode];
  const full = TRANSPORT_LABELS[mode];
  const pending = status === "pending";

  if (mode === "other_district") {
    const where = viaUnit ?? "지구 미지정";
    return {
      text: pending ? `${where} 대기` : where,
      tone: pending ? "warning" : "primary",
      title: pending
        ? `${where} 차량 — 아직 확정 안 됨. 우리 버스 좌석을 잡아둔 상태입니다.`
        : `${where} 차량 이용 (확정)`,
    };
  }
  return { text: short, tone: "mute", title: full };
}

/** 사람 단위 요약 한 줄 — 상·하행이 다르면 둘 다 보여준다. */
export function transportSummaryText(
  up: { mode?: TransportMode | null; via?: string | null } | null,
  down: { mode?: TransportMode | null; via?: string | null } | null
): string {
  const one = (
    leg: { mode?: TransportMode | null; via?: string | null } | null
  ): string => {
    if (!leg?.mode || leg.mode === "our_bus") return "우리 버스";
    if (leg.mode === "other_district") return `${leg.via ?? "타지구"} 차량`;
    return TRANSPORT_LABELS[leg.mode];
  };
  const u = one(up);
  const d = one(down);
  return u === d
    ? u
    : `${DIRECTION_SHORT.up} ${u} · ${DIRECTION_SHORT.down} ${d}`;
}
