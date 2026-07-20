/**
 * DB enum 값 ↔ UI 한글 라벨 매핑 (SPEC 결정 #2: 영문 DB + UI 한글 라벨).
 */
import type {
  AttendanceType,
  DepartureSlot,
  PaymentStatus,
} from "@/lib/supabase/types";

export const ATTENDANCE_LABELS: Record<AttendanceType, string> = {
  roundtrip: "왕복",
  oneway: "편도",
  self: "참석(버스X)",
};

/** 출발 슬롯 id → 한글 라벨. 미지정(하행편도)·미존재는 "—". */
export function slotLabel(
  slotId: number | null | undefined,
  slots: Pick<DepartureSlot, "id" | "label">[]
): string {
  if (slotId == null) return "—";
  return slots.find((s) => s.id === slotId)?.label ?? "—";
}

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "미납",
  paid: "완납",
  waived: "면제",
};

export const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "paid", "waived"];

/**
 * fee=0(버스 미이용 = attendance_type 'self') 행의 납부 상태 표시 규칙.
 * fee 는 GENERATED 컬럼이라 왕복/편도 → 미이용으로 바꾸면 자동으로 0이 되지만
 * payment_status 는 그대로 남는다. 그래서 두 가지가 섞여 있다.
 *   - 비고에 '환불' 이 있으면 → 이미 낸 돈을 돌려줘야 하는 실제 채무. 감추면 안 됨.
 *   - 그 외 → 애초에 부과 대상이 아니므로 '해당없음'.
 * fee > 0 이면 null 을 돌려주고, 호출부는 기존 배지를 그대로 그린다.
 */
export function paymentDisplayOverride(
  fee: number | null | undefined,
  note: string | null | undefined
): { label: string; variant: "warning" | "mute" } | null {
  if ((fee ?? 0) > 0) return null;
  if ((note ?? "").includes("환불"))
    return { label: "환불 대기", variant: "warning" };
  return { label: "해당없음", variant: "mute" };
}

/** CSV·폼 입력의 한글 → enum 역매핑. */
export const ATTENDANCE_FROM_KO: Record<string, AttendanceType> = {
  왕복: "roundtrip",
  편도: "oneway",
  "버스 미이용": "self",
  미이용: "self",
  "참석(버스X)": "self",
};

export const BOOL_FROM_KO: Record<string, boolean> = {
  O: true,
  X: false,
  Y: true,
  N: false,
  true: true,
  false: false,
  체크: true,
};

/**
 * 참석 유형·상행 슬롯·하행 차량 이용을 한 셀로 묶은 조합 (SPEC §4.3).
 * 셀 인라인 편집 시 이 preset 단위로 선택하면 왕복/편도 CHECK 일관성이 항상 보장됨.
 *
 * 슬롯이 데이터(departure_slots)라 preset 도 동적 생성: active 슬롯마다
 * {왕복·편도상행} 2개 + 공통 {편도하행} 1개. 슬롯 추가 = preset 자동 증가.
 */
export type AttendancePreset = {
  key: string;
  label: string;
  attendance_type: AttendanceType;
  departure_slot_id: number | null;
  uses_return_bus: boolean;
};

export const OW_DOWN_KEY = "ow_down";
/** 버스 미이용(KTX·자차 등 개인 이동) 공통 preset. 배차·정산 통계 모두에서 제외. */
export const SELF_KEY = "self";

/** 하행편도 공통 preset (슬롯 무관). */
const OW_DOWN_PRESET: AttendancePreset = {
  key: OW_DOWN_KEY,
  label: "편도 하행",
  attendance_type: "oneway",
  departure_slot_id: null,
  uses_return_bus: true,
};

/** 버스 미이용 공통 preset (슬롯 무관, 하행 미이용). */
const SELF_PRESET: AttendancePreset = {
  key: SELF_KEY,
  label: "참석 (버스 미이용)",
  attendance_type: "self",
  departure_slot_id: null,
  uses_return_bus: false,
};

/** active 슬롯(display_order 순)으로 preset 목록 생성. 끝에 편도하행·미이용 공통 추가. */
export function buildAttendancePresets(
  slots: Pick<DepartureSlot, "id" | "key" | "label" | "active" | "display_order">[]
): AttendancePreset[] {
  const active = slots
    .filter((s) => s.active)
    .sort((a, b) => a.display_order - b.display_order);
  const out: AttendancePreset[] = [];
  for (const s of active) {
    out.push({
      key: `rt_${s.key}`,
      label: `왕복 (${s.label})`,
      attendance_type: "roundtrip",
      departure_slot_id: s.id,
      uses_return_bus: true,
    });
    out.push({
      key: `ow_up_${s.key}`,
      label: `편도 상행 (${s.label})`,
      attendance_type: "oneway",
      departure_slot_id: s.id,
      uses_return_bus: false,
    });
  }
  out.push(OW_DOWN_PRESET);
  out.push(SELF_PRESET);
  return out;
}

export function presetKeyOf(
  row: {
    attendance_type: AttendanceType;
    departure_slot_id: number | null;
    uses_return_bus: boolean;
  },
  presets: AttendancePreset[]
): string | null {
  return (
    presets.find(
      (p) =>
        p.attendance_type === row.attendance_type &&
        p.departure_slot_id === row.departure_slot_id &&
        p.uses_return_bus === row.uses_return_bus
    )?.key ?? null
  );
}

export function presetByKey(
  key: string,
  presets: AttendancePreset[]
): AttendancePreset | undefined {
  return presets.find((p) => p.key === key);
}
