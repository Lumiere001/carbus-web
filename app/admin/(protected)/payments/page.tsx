import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import {
  PaymentsPanel,
  type ThreeWayRow,
  type WaivedRow,
} from "@/components/admin/payments-panel";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<{ role: UserRole }>();
  const isMaster = profile?.role === "master";

  const [rowsRes, campusRes, summaryRes, waivedRes] = await Promise.all([
    supabase.from("v_payment_3way_comparison").select("*"),
    supabase.from("campuses").select("id, name, display_order"),
    supabase
      .from("v_payment_summary")
      .select("campus_id, paid_total, unpaid_total, unpaid_count, paid_count"),
    supabase
      .from("registrations")
      .select("id, name, campus_id, note")
      .eq("payment_status", "waived")
      .order("name"),
  ]);

  const orderOf = new Map(
    (campusRes.data ?? []).map((c) => [c.id, c.display_order])
  );
  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));
  const summaryOf = new Map(
    (summaryRes.data ?? []).map((s) => [s.campus_id, s])
  );

  // 3중비교 행에 걷어야 할 금액(완납+미납) · 미납 인원 병합
  const sorted = (rowsRes.data ?? [])
    .map((r) => {
      const s = summaryOf.get(r.campus_id);
      return {
        ...r,
        target: (s?.paid_total ?? 0) + (s?.unpaid_total ?? 0),
        unpaid_count: s?.unpaid_count ?? 0,
        paid_count: s?.paid_count ?? 0,
      };
    })
    .sort(
      (a, b) =>
        (orderOf.get(a.campus_id ?? "") ?? 0) -
        (orderOf.get(b.campus_id ?? "") ?? 0)
    );

  const waived: WaivedRow[] = (waivedRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    campus_name: campusName.get(r.campus_id) ?? "—",
    note: r.note,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">차량비 정산</h2>
        <p className="text-sm text-muted mt-0.5">
          시스템 완납 · 캠퍼스 송금 · 총단 입금 3중 비교
          {isMaster ? " · 총단 입금액 편집" : " (보기 전용)"}
        </p>
      </div>
      <PaymentsPanel
        rows={sorted as ThreeWayRow[]}
        isMaster={isMaster}
        waived={waived}
      />
    </div>
  );
}
