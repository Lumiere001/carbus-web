import type { AttendanceSnapshot, AttendanceState } from "@/lib/attendance/state";
import type { DepartureSlot } from "@/lib/supabase/types";

export type AttendanceMember = AttendanceSnapshot & {
  readonly name: string;
  readonly student_id: string;
  readonly campus?: string;
};

export type AttendanceGroup = readonly [number, readonly AttendanceMember[]];
export type AttendanceBus = {
  readonly id: number;
  readonly name: string;
  readonly up_trip_id: number | null;
};
export type AttendanceSlot = Readonly<Pick<DepartureSlot, "id" | "label">>;
export type AttendanceDirection = "up" | "down";
export type AttendanceField = "checked_in" | "checked_out";
export type AttendanceSummaryData = {
  readonly slots: readonly { readonly id: number; readonly label: string; readonly total: number }[];
  readonly returnTotal: number;
};
export type BusAttendanceProps = {
  readonly campusId?: string;
  readonly upGroups: readonly AttendanceGroup[];
  readonly downGroups: readonly AttendanceGroup[];
  readonly buses: readonly AttendanceBus[];
  readonly slots: readonly AttendanceSlot[];
  readonly editable?: boolean;
  readonly summary?: AttendanceSummaryData;
};

export function attendanceProgress(
  members: readonly AttendanceMember[],
  state: AttendanceState,
  field: AttendanceField
) {
  return {
    done: members.filter((member) => state[member.id]?.[field] ?? member[field]).length,
    total: members.length,
  };
}
