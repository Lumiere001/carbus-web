import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PickupBoard, type BoardRow } from "@/components/pickup/pickup-board";

export const dynamic = "force-dynamic";

/**
 * 임역원 수송 요청 화면 (동규님 요청, 2026-07-28).
 *
 * 관리자에게만 있던 보드를 임역원도 본다. 임역원이 묻는 것은 관리자와 다르다 —
 * 관리자는 "차를 언제 몇 대 보낼까"(시각별), 임역원은 **"우리 캠퍼스 사람들이 어디로
 * 모이나"**(장소별)다. 그래서 기본 묶음을 장소로 둔다.
 *
 * RLS 가 이미 본인 캠퍼스로 좁히지만 `campus_id` 로도 명시해 거른다 — 뷰를 나중에
 * 고칠 때 한쪽만 바뀌면 남의 캠퍼스가 새는 쪽으로 조용히 틀어진다.
 */
export default async function CampusPickupPage() {
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
  if (!profile?.campus_id) redirect("/pending");

  const { data } = await supabase
    .from("v_pickup_board")
    .select(
      "id, direction, pickup_at, pickup_date, pickup_time, place, note, person_name, campus_name"
    )
    .eq("campus_id", profile.campus_id)
    .order("pickup_at", { nullsFirst: true });

  const rows = (data ?? []) as BoardRow[];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">수송 요청</h2>
        <p className="text-sm text-muted mt-0.5">
          우리 캠퍼스에서 <b>따로 데리러 가야 하는</b> 사람들입니다. 장소별로 묶여 있어요.
          시각이 안 정해진 사람은 맨 위에 빨갛게 나옵니다 — 그 사람들에게 도착 시각을
          먼저 물어봐 주세요.
        </p>
      </div>

      <PickupBoard
        rows={rows}
        audience="campus"
        defaultGroupBy="place"
        title="우리 캠퍼스 수송 요청"
        emptyHint="아직 수송 요청이 없습니다. ‘순장/순원 입력’ 화면에서 사람을 열고 수송 요청을 추가하면 여기에 장소별로 묶여서 보입니다."
      />
    </div>
  );
}
