import { z } from "zod";

export const attendanceSnapshotSchema = z.object({
  id: z.string(), checked_in: z.boolean(), checked_out: z.boolean(),
  version: z.number().int().positive(),
}).readonly();
export type AttendanceSnapshot = z.infer<typeof attendanceSnapshotSchema>;
export type AttendanceState = Readonly<Record<string, AttendanceSnapshot>>;

/** The same registration revision orders SSR, Realtime and the read after a saved check. */
export function mergeAttendance(current: AttendanceState, incoming: readonly AttendanceSnapshot[]): AttendanceState {
  const next = { ...current };
  for (const row of incoming) {
    if (row.version > (next[row.id]?.version ?? 0)) next[row.id] = row;
  }
  return next;
}
