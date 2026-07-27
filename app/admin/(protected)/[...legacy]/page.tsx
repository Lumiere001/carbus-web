import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminHref } from "@/lib/events/route";

export const dynamic = "force-dynamic";

/** 폴더화 전에 쓰던 주소들. 북마크·저장된 링크가 죽지 않게 넘겨준다. */
const KNOWN = new Set([
  "attendance", "batch", "buses", "changes", "control", "errors", "leaders",
  "logs", "partial", "payments", "registrations", "roles", "trips", "users",
]);

/**
 * 옛 주소(`/admin/buses`) → 새 주소(`/admin/e/<진행 중 행사>/buses`) (Phase 4-5).
 *
 * 정적 세그먼트 `e` 가 이 catch-all 보다 우선하므로 `/admin/e/...` 는 여기 안 온다.
 * 모르는 경로는 404 로 둔다 — 아무 데나 대시보드로 보내면 오타를 감춘다.
 */
export default async function LegacyAdminRedirect({
  params,
}: {
  params: Promise<{ legacy: string[] }>;
}) {
  const { legacy } = await params;
  if (!legacy?.length || !KNOWN.has(legacy[0])) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (!data?.id) notFound();

  redirect(adminHref(data.id, `/${legacy.join("/")}`));
}
