import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminHref } from "@/lib/events/route";

export const dynamic = "force-dynamic";

/**
 * `/admin` → 진행 중 행사의 대시보드로 보낸다 (Phase 4-5).
 *
 * 폴더화 뒤 관리자 화면의 진짜 주소는 `/admin/e/<행사>/...` 다. 이 페이지는
 * "어느 행사인지 안 적힌 주소"를 받아 기본값(진행 중 행사)으로 넘겨주는 입구다.
 */
export default async function AdminIndexPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  // 진행 중 행사가 없으면(전부 닫힘) 가장 최근 행사라도 연다.
  const fallback = data?.id
    ? data.id
    : (
        await supabase
          .from("events")
          .select("id")
          .order("starts_on", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data?.id;

  if (!fallback) redirect("/admin/login");
  redirect(adminHref(fallback));
}
