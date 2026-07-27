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

/** 짧은 배지 문구. 명단 표에서 한 칸에 들어가야 한다. */
export const TRANSPORT_SHORT: Record<TransportMode, string> = {
  our_bus: "버스",
  other_district: "타지구",
  ktx: "KTX",
  own_car: "자차",
  other: "기타",
};

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
  return u === d ? u : `갈 때 ${u} · 올 때 ${d}`;
}
