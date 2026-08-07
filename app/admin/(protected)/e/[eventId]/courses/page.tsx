import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { CourseBoard, type CourseRow } from "@/components/admin/course-board";

export const dynamic = "force-dynamic";

/**
 * 수강신청 현황 (동규님 요청, 2026-07-31).
 *
 * 입력은 `전체 순장/순원` 화면의 편집 서랍에서 사람별로 한다. 여기는 그걸
 * **날·시간으로 몰아 보는** 자리다 — 그대로 강의실 명단이 된다.
 *
 * 뷰(`v_course_board`)가 취소자를 이미 걸러 준다. 취소한 사람이 명단에 남으면
 * 강의실 인원이 틀린다.
 */
export default async function AdminCoursesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<{ role: UserRole }>();
  const role: UserRole = profile?.role ?? "guest";
  if (role !== "master" && role !== "viewer") redirect("/admin");

  // RLS 의 event_scope 가 "지금 보는 행사" 로 이미 좁힌다 — 여기서 또 거르지 않는다.
  // 두 곳에서 거르면 한쪽만 고쳤을 때 조용히 어긋난다.
  const { data } = await supabase
    .from("v_course_board")
    .select("*")
    .order("day_no")
    .order("at_time", { nullsFirst: true });

  const rows: CourseRow[] = (data ?? []).map((r) => ({
    id: r.id ?? 0,
    dayNo: r.day_no ?? 1,
    // `time` 은 `HH:MM:SS` 로 온다. 화면에는 분까지만.
    atTime: r.at_time ? String(r.at_time).slice(0, 5) : null,
    personName: r.person_name ?? "—",
    studentId: r.student_id,
    campusName: r.campus_name,
    campusOrder: r.campus_order,
    onDate: r.on_date,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">수강신청</h2>
        <p className="text-sm text-muted mt-0.5">
          누가 어느 날 몇 시 강의를 듣는지 모아 봅니다. 입력은{" "}
          <b>전체 순장/순원</b> 화면에서 사람을 열고 <b>수강신청</b>에서 합니다 —
          해당 없는 사람은 아무것도 안 고르면 됩니다.
        </p>
      </div>

      <CourseBoard rows={rows} />
    </div>
  );
}
