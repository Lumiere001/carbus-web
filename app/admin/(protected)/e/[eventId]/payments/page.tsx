import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import {
  PaymentsPanel,
  type ThreeWayRow,
  type WaivedRow,
  type BalanceRow,
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

  const [rowsRes, campusRes, summaryRes, waivedRes, balanceRes] = await Promise.all([
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
    // 낸 돈이 현재 청구액보다 많은 사람 (장부 계산). 참여형태를 바꾸면서
    // 청구액이 줄었는데 이미 받은 돈은 그대로인 경우 — 환불 확인 대상.
    supabase
      .from("v_payment_balance")
      .select(
        "registration_id, name, campus_id, charged_now, fee_now, paid_total, balance, refund_due, refund_reason, note"
      )
      // 3-D: 장부 잔액이 아니라 **지금 기준 환불 대상**으로 고른다. 납부 후 편성을
      // 바꾼 사람은 장부가 안 움직여서 예전엔 이 목록에 아예 안 떴다.
      // 돌려줄 돈이 **확정된** 사람(refund_due > 0)만 보면, 낸 기록이 장부에 없는
      // 사람은 청구액이 줄어도 안 잡힌다. 타지구 확정으로 좌석이 반납되면 바로
      // 그 상태가 되므로(왕복 → 편도), 사유가 있는 사람은 전부 싣는다.
      .or("refund_due.gt.0,refund_reason.not.is.null")
      .order("refund_due", { ascending: false }),
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

  const balances: BalanceRow[] = (balanceRes.data ?? []).map((b) => ({
    registration_id: b.registration_id as string,
    name: (b.name as string) ?? "—",
    campus_name: campusName.get(b.campus_id as string) ?? "—",
    charged_now: b.charged_now ?? 0,
    fee_now: b.fee_now ?? 0,
    paid_total: b.paid_total ?? 0,
    balance: b.balance ?? 0,
    refund_due: b.refund_due ?? 0,
    refund_reason: b.refund_reason ?? null,
    note: b.note ?? null,
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
        balances={balances}
      />
    </div>
  );
}
