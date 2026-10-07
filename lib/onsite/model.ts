import { z } from "zod";

export const visitSchema = z.object({
  id: z.uuid().brand<"VisitId">(),
  visit_number: z.number().int().positive(),
  version: z.number().int().positive(),
  arrived_at: z.iso.datetime({ offset: true }).nullable(),
  departed_at: z.iso.datetime({ offset: true }).nullable(),
}).readonly();
export type Visit = z.infer<typeof visitSchema>;
export const onsiteStateSchema = z.object({
  registration_id: z.uuid().brand<"RegistrationId">(),
  revision: z.number().int().nonnegative(),
  visits: z.array(visitSchema).readonly(),
}).readonly();
export const onsiteSnapshotSchema = z.array(onsiteStateSchema).readonly();
export type OnsiteState = z.infer<typeof onsiteStateSchema>;
export type OnsiteSnapshot = z.infer<typeof onsiteSnapshotSchema>;

const correctionSchema = z.object({
  action: z.literal("correct"),
  visit_id: z.uuid(),
  visit_version: z.number().int().positive(),
  arrived_at: z.iso.datetime({ offset: true }).nullable(),
  departed_at: z.iso.datetime({ offset: true }).nullable(),
  reason: z.string().trim().min(1).max(500),
});
export const onsiteCommandSchema = z.union([
  z.object({ action: z.enum(["arrive", "depart"]) }), correctionSchema,
]);
export type OnsiteCommand = z.infer<typeof onsiteCommandSchema>;

/** Never replace a newer Realtime/acknowledged snapshot with a late response. */
export function mergeOnsite(current: OnsiteSnapshot, incoming: OnsiteSnapshot): OnsiteSnapshot {
  const next = new Map(current.map((state) => [state.registration_id, state]));
  for (const state of incoming) {
    if (state.revision >= (next.get(state.registration_id)?.revision ?? -1)) next.set(state.registration_id, state);
  }
  return [...next.values()];
}
