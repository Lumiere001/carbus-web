import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { slotLabel } from "@/lib/labels";
import type { AttendanceType, DepartureSlot } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type SlotMini = Pick<DepartureSlot, "id" | "label">;
type CampusMini = { id: string; name: string; display_order: number };
type Reg = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  departure_slot_id: number | null;
  uses_return_bus: boolean;
  note: string | null;
};

function onewayLabel(r: Reg, slots: SlotMini[]): string {
  // 편도: 상행만(하행 미이용) 또는 하행만(슬롯 없음)
  if (r.departure_slot_id !== null && !r.uses_return_bus)
    return `편도 상행 (${slotLabel(r.departure_slot_id, slots)})`;
  if (r.departure_slot_id === null && r.uses_return_bus) return "편도 하행";
  return "편도";
}

/** 캠퍼스 id 기준 그룹핑. */
function groupByCampus(regs: Reg[]): Map<string, Reg[]> {
  const m = new Map<string, Reg[]>();
  for (const r of regs) {
    const list = m.get(r.campus_id) ?? [];
    list.push(r);
    m.set(r.campus_id, list);
  }
  return m;
}

export default async function AdminPartialPage() {
  const supabase = await createClient();
  const [regRes, campusRes, slotRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, attendance_type, departure_slot_id, uses_return_bus, note"
      )
      // 취소자는 명단·집계에서 제외한다(좌석 반납은 DB 트리거가 처리).
      .neq("participation_status", "cancelled")
      .in("attendance_type", ["oneway", "self"])
      .order("campus_id"),
    supabase.from("campuses").select("id, name, display_order"),
    supabase.from("departure_slots").select("id, label").order("display_order"),
  ]);
  const all = (regRes.data ?? []) as Reg[];
  const slots = (slotRes.data ?? []) as SlotMini[];
  const campuses = ((campusRes.data ?? []) as CampusMini[]).sort(
    (a, b) => a.display_order - b.display_order
  );

  const oneway = all.filter((r) => r.attendance_type === "oneway");
  const self = all.filter((r) => r.attendance_type === "self");
  const onewayByCampus = groupByCampus(oneway);
  const selfByCampus = groupByCampus(self);

  // 칩 집계: 비고 텍스트 파싱 없이 컬럼값만으로 계산 (의미 분류는 스키마 생긴 뒤에).
  const onewayUp = oneway.filter(
    (r) => r.departure_slot_id !== null && !r.uses_return_bus
  ).length;
  const onewayDown = oneway.filter(
    (r) => r.departure_slot_id === null && r.uses_return_bus
  ).length;
  const selfMissingNote = self.filter((r) => !r.note?.trim()).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          부분 참석자 · 개인 이동
        </h2>
        <p className="text-sm text-muted mt-0.5">
          편도(상행만 / 하행만) 신청자 + 버스 미이용(KTX·자차 등)을 한 화면에서 확인.
        </p>
      </div>

      {/* 섹션 1: 편도 (부분 참석) */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-foreground">
            부분 참석자 (편도)
          </h3>
          <span className="text-sm text-muted">
            <b className="tabular-nums text-foreground">{oneway.length}</b>명
          </span>
          <Badge variant="mute">상행만 {onewayUp}</Badge>
          <Badge variant="mute">하행만 {onewayDown}</Badge>
        </div>
        {oneway.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-muted">편도 신청자가 없습니다.</p>
          </Card>
        ) : (
          campuses
            .filter((c) => (onewayByCampus.get(c.id)?.length ?? 0) > 0)
            .map((c) => {
              const members = onewayByCampus.get(c.id) ?? [];
              return (
                <Card key={c.id} title={c.name} subtitle={`${members.length}명`}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
                          <th className="px-4 py-2.5">이름</th>
                          <th className="px-4 py-2.5">학번</th>
                          <th className="px-4 py-2.5">유형</th>
                          <th className="px-4 py-2.5">비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((r) => (
                          <tr key={r.id} className="border-t border-border">
                            <td className="px-4 py-2 text-foreground whitespace-nowrap">
                              {r.name}
                            </td>
                            <td className="px-4 py-2 text-muted-2">{r.student_id}</td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <Badge variant="mute">{onewayLabel(r, slots)}</Badge>
                            </td>
                            <td className="px-4 py-2 text-muted-2 whitespace-pre-wrap break-words max-w-[20rem]">
                              {r.note?.trim() ? r.note : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })
        )}
      </section>

      {/* 섹션 2: 미이용 (개인 이동) */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-foreground">
            개인 이동 (버스 미이용)
          </h3>
          <span className="text-sm text-muted">
            <b className="tabular-nums text-foreground">{self.length}</b>명
          </span>
          {selfMissingNote > 0 && (
            <Badge variant="warning">비고 미기재 {selfMissingNote}</Badge>
          )}
          <span className="text-xs text-muted-2">
            · KTX·자차 등 버스 안 타는 분 (전체 참석)
          </span>
        </div>
        {self.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-muted">버스 미이용 신청자가 없습니다.</p>
          </Card>
        ) : (
          campuses
            .filter((c) => (selfByCampus.get(c.id)?.length ?? 0) > 0)
            .map((c) => {
              const members = selfByCampus.get(c.id) ?? [];
              const missingNote = members.filter((m) => !m.note?.trim()).length;
              return (
                <Card
                  key={c.id}
                  title={c.name}
                  subtitle={
                    missingNote > 0
                      ? `${members.length}명 · 이동 수단 미기재 ${missingNote}건`
                      : `${members.length}명`
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
                          <th className="px-4 py-2.5">이름</th>
                          <th className="px-4 py-2.5">학번</th>
                          <th className="px-4 py-2.5">이동 수단 (비고)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((r) => {
                          const empty = !r.note?.trim();
                          return (
                            <tr
                              key={r.id}
                              className={
                                "border-t border-border " +
                                (empty ? "bg-warning-bg/30" : "")
                              }
                            >
                              <td className="px-4 py-2 text-foreground whitespace-nowrap">
                                {r.name}
                              </td>
                              <td className="px-4 py-2 text-muted-2">{r.student_id}</td>
                              <td className="px-4 py-2 text-muted-2 whitespace-pre-wrap break-words max-w-[24rem]">
                                {empty ? (
                                  <span className="text-warning">
                                    ⚠ 이동 수단 미기재 — 비고에 적어주세요
                                  </span>
                                ) : (
                                  r.note
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })
        )}
      </section>
    </div>
  );
}
