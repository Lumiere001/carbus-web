import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  CampusPaymentsPanel,
  type PayRow,
  type RemittanceRow,
} from "@/components/campus/payments-panel";

export const dynamic = "force-dynamic";

export default async function CampusPaymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("campus_id")
    .eq("id", user.id)
    .single();
  const campusId = profile?.campus_id;
  if (!campusId) redirect("/pending");

  // RLS 가 campus_admin 을 본인 캠퍼스로 스코프 → 원본 테이블 직접 조회 (집계 뷰 우회).
  const [regRes, campusRes, remitRes] = await Promise.all([
    supabase
      .from("registrations")
      .select("id, name, student_id, attendance_type, fee, payment_status")
      // 취소자는 명단·집계에서 제외한다(좌석 반납은 DB 트리거가 처리).
      .neq("participation_status", "cancelled")
      .eq("campus_id", campusId)
      // 버스 미이용(self)은 차량비 없음 → 정산 화면에서 제외 (전체는 /campus 그리드에서 봄)
      .in("attendance_type", ["roundtrip", "oneway"])
      .order("created_at", { ascending: true }),
    supabase.from("campuses").select("name").eq("id", campusId).single(),
    supabase
      .from("campus_remittances")
      .select("id, amount, note, created_at")
      .eq("campus_id", campusId)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <CampusPaymentsPanel
      campusName={campusRes.data?.name ?? "내"}
      rows={(regRes.data ?? []) as PayRow[]}
      remittances={(remitRes.data ?? []) as RemittanceRow[]}
    />
  );
}
