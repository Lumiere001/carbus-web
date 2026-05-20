/**
 * DB enum 값 ↔ UI 한글 라벨 매핑 (SPEC 결정 #2: 영문 DB + UI 한글 라벨).
 */
import type {
  AttendanceType,
  DepartureDay,
  PaymentStatus,
} from "@/lib/supabase/types";

export const ATTENDANCE_LABELS: Record<AttendanceType, string> = {
  roundtrip: "왕복",
  oneway: "편도",
};

export const DAY_LABELS: Record<DepartureDay, string> = {
  TUE: "화요일",
  WED: "수요일",
};

/** departure_day NULL 포함 표시용. */
export function dayLabel(d: DepartureDay | null): string {
  return d ? DAY_LABELS[d] : "—";
}

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "미납",
  paid: "완납",
  waived: "면제",
};

export const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "paid", "waived"];

/** CSV·폼 입력의 한글 → enum 역매핑. */
export const ATTENDANCE_FROM_KO: Record<string, AttendanceType> = {
  왕복: "roundtrip",
  편도: "oneway",
};

export const DAY_FROM_KO: Record<string, DepartureDay | null> = {
  화요일: "TUE",
  수요일: "WED",
  "": null,
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
 * 참석 유형·상행 요일·하행 차량 이용을 한 셀로 묶은 5가지 조합 (SPEC §4.3).
 * 셀 인라인 편집 시 이 preset 단위로 선택하면 왕복/편도 CHECK 일관성이 항상 보장됨.
 */
export type AttendancePreset = {
  key: string;
  label: string;
  attendance_type: AttendanceType;
  departure_day: DepartureDay | null;
  uses_return_bus: boolean;
};

export const ATTENDANCE_PRESETS: AttendancePreset[] = [
  { key: "rt_tue", label: "왕복 (화)", attendance_type: "roundtrip", departure_day: "TUE", uses_return_bus: true },
  { key: "rt_wed", label: "왕복 (수)", attendance_type: "roundtrip", departure_day: "WED", uses_return_bus: true },
  { key: "ow_up_tue", label: "편도 상행 (화)", attendance_type: "oneway", departure_day: "TUE", uses_return_bus: false },
  { key: "ow_up_wed", label: "편도 상행 (수)", attendance_type: "oneway", departure_day: "WED", uses_return_bus: false },
  { key: "ow_down", label: "편도 하행", attendance_type: "oneway", departure_day: null, uses_return_bus: true },
];

export function presetKeyOf(row: {
  attendance_type: AttendanceType;
  departure_day: DepartureDay | null;
  uses_return_bus: boolean;
}): string | null {
  return (
    ATTENDANCE_PRESETS.find(
      (p) =>
        p.attendance_type === row.attendance_type &&
        p.departure_day === row.departure_day &&
        p.uses_return_bus === row.uses_return_bus
    )?.key ?? null
  );
}

export function presetByKey(key: string): AttendancePreset | undefined {
  return ATTENDANCE_PRESETS.find((p) => p.key === key);
}
