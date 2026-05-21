import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { slotLabel } from "@/lib/labels";
import type { DepartureSlot } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type SlotMini = Pick<DepartureSlot, "id" | "label">;
type Reg = {
  id: string;
  name: string;
  student_id: string;
  departure_slot_id: number | null;
  uses_return_bus: boolean;
  note: string | null;
};

function partialLabel(r: Reg, slots: SlotMini[]): string {
  if (r.departure_slot_id !== null && !r.uses_return_bus)
    return `편도 상행 (${slotLabel(r.departure_slot_id, slots)})`;
  if (r.departure_slot_id === null && r.uses_return_bus) return "편도 하행";
  return "편도";
}

export default async function CampusPartialPage() {
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

  // RLS가 본인 캠퍼스로 한정. 명시적으로도 필터.
  const [{ data }, { data: slotData }] = await Promise.all([
    supabase
      .from("registrations")
      .select("id, name, student_id, departure_slot_id, uses_return_bus, note")
      .eq("campus_id", profile.campus_id)
      .eq("attendance_type", "oneway")
      .order("name"),
    supabase.from("departure_slots").select("id, label").order("display_order"),
  ]);
  const regs = (data ?? []) as Reg[];
  const slots = (slotData ?? []) as SlotMini[];

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold text-foreground">부분 참석자</h2>
        <p className="text-sm text-muted mt-0.5">
          우리 캠퍼스 편도(상행만 / 하행만) 신청자입니다. 비고(평창역 도착/귀가 일정 등)는
          ‘순장/순원 입력’ 화면의 비고 칸에서 적을 수 있어요.
        </p>
      </div>

      {regs.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted">부분 참석자가 없습니다.</p>
        </Card>
      ) : (
        <Card subtitle={`${regs.length}명`}>
          <ul className="divide-y divide-border">
            {regs.map((r) => (
              <li key={r.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base text-foreground">
                    {r.name}
                    <span className="ml-1.5 text-xs text-muted-2">{r.student_id}</span>
                  </span>
                  <Badge variant="mute">{partialLabel(r, slots)}</Badge>
                </div>
                {r.note?.trim() && (
                  <p className="mt-1 text-sm text-muted whitespace-pre-wrap break-words">
                    {r.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
