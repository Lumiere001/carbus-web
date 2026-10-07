import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const fareChangeSchema = z.object({
  registration_id: z.string(), created_at: z.string(),
  before_type: z.string().nullable(), after_type: z.string().nullable(),
  before_fee: z.number().nullable(), after_fee: z.number().nullable(),
});
export type FareChange = z.infer<typeof fareChangeSchema>;
export type BalanceHistory = {
  readonly fareChange?: FareChange;
  readonly ledger?: Pick<Database["public"]["Tables"]["payment_ledger"]["Row"], "kind" | "amount" | "occurred_at" | "created_at" | "source">;
};

export function changesFare(entry: FareChange): boolean {
  return entry.before_type !== entry.after_type || entry.before_fee !== entry.after_fee;
}

/** Read actual source records; unrelated edits and missing historical times stay distinct. */
export async function loadBalanceHistory(client: SupabaseClient<Database>, ids: readonly string[]): Promise<
  { readonly ok: true; readonly histories: ReadonlyMap<string, BalanceHistory> } | { readonly ok: false }
> {
  const histories = new Map<string, BalanceHistory>();
  if (ids.length === 0) return { ok: true, histories };
  const fares = new Set<string>();
  const ledgers = new Set<string>();
  for (let offset = 0; fares.size < ids.length; offset += 1000) {
    const result = await client.from("registration_audit")
      .select("registration_id,created_at,before_type:before_value->>attendance_type,after_type:after_value->>attendance_type,before_fee:before_value->fee,after_fee:after_value->fee")
      .eq("change_type", "update").in("registration_id", [...ids])
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 999);
    if (result.error) return { ok: false };
    for (const raw of result.data) {
      const parsed = fareChangeSchema.safeParse(raw);
      if (!parsed.success) return { ok: false };
      const entry = parsed.data;
      if (!fares.has(entry.registration_id) && changesFare(entry)) {
        histories.set(entry.registration_id, { ...histories.get(entry.registration_id), fareChange: entry });
        fares.add(entry.registration_id);
      }
    }
    if (result.data.length < 1000) break;
  }
  for (let offset = 0; ledgers.size < ids.length; offset += 1000) {
    const result = await client.from("payment_ledger")
      .select("registration_id,kind,amount,occurred_at,created_at,source")
      .in("registration_id", [...ids]).in("kind", ["payment", "refund", "adjust"])
      .order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 999);
    if (result.error) return { ok: false };
    for (const entry of result.data) {
      if (ledgers.has(entry.registration_id)) continue;
      histories.set(entry.registration_id, { ...histories.get(entry.registration_id), ledger: entry });
      ledgers.add(entry.registration_id);
    }
    if (result.data.length < 1000) break;
  }
  return { ok: true, histories };
}
