import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { attendanceSummary } from "@/lib/labels";
import {
  transportBadge,
  TRANSPORT_LABELS,
  DIRECTION_SHORT,
  type TransportMode,
  type TransportStatus,
} from "@/lib/transport/labels";
import type { EventTrip } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * 임역원 부분 참석 화면.
 *
 * 동규님 요청: **"사람 명단만 보여주는 것이 아니라 부분 참석하게 된 사유들 밑에
 * 묶어서 같이 보여주면 좋겠다."**
 *
 * 예전엔 편도(oneway)인 사람만 한 줄로 늘어놓았다. 두 가지가 빠져 있었다:
 *   ① **우리 버스를 아예 안 타는 사람(self)** 과 **며칠만 참석하는 사람**이 아예
 *      안 나왔다. 왕복으로 타면서 하루만 있다 가는 사람은 부분참인데 이 화면에
 *      존재하지 않았다.
 *   ② 왜 부분참인지가 안 보였다. 이름만 있으면 임역원이 그다음에 할 게 없다 —
 *      전화를 걸어 다시 물어봐야 한다.
 *
 * 그래서 **사유별 묶음**으로 바꾼다. 한 사람이 두 사유에 걸리면(예: 개인 이동이면서
 * 며칠만 참석) 양쪽에 나온다 — 사유마다 확인해야 할 것이 다르기 때문이다.
 *
 * 관리자 화면(`/admin/e/../partial`)과 **일부러 다르게** 만들었다. 거기는 16개
 * 캠퍼스를 한 표에서 비교하는 자리라 필터 달린 표가 맞고, 여기는 자기 캠퍼스
 * 몇 명을 "왜"와 함께 읽는 자리다.
 */

type Reg = {
  id: string;
  name: string;
  student_id: string;
  attendance_type: "roundtrip" | "oneway" | "self";
  up_trip_id: number | null;
  down_trip_id: number | null;
  note: string | null;
  attend_from: string | null;
  attend_to: string | null;
};

type Leg = { mode: TransportMode; status: TransportStatus; via: string | null };

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

  // RLS 가 본인 캠퍼스로 한정한다. 명시적으로도 거른다 — 한쪽만 바뀌면 남의 캠퍼스가
  // 새는 쪽으로 조용히 틀어진다.
  const [{ data }, { data: tripData }, { data: legData }, { data: unitData }] =
    await Promise.all([
      supabase
        .from("registrations")
        .select(
          "id, name, student_id, attendance_type, up_trip_id, down_trip_id, note, attend_from, attend_to"
        )
        // 취소자는 명단에서 제외한다(좌석 반납은 DB 트리거가 처리).
        .neq("participation_status", "cancelled")
        .eq("campus_id", profile.campus_id)
        // 관리자 화면과 **같은 술어**다. 버스 이용만으로 거르면 왕복으로 타면서
        // 며칠만 있다 가는 사람이 통째로 빠진다.
        .or("attendance_type.in.(oneway,self),attend_from.not.is.null,attend_to.not.is.null")
        .order("name"),
      supabase
        .from("event_trips")
        .select("id, label")
        .order("direction")
        .order("display_order"),
      supabase
        .from("transport_legs")
        .select("registration_id, direction, mode, status, via_unit_id"),
      supabase.from("org_units").select("id, name"),
    ]);

  const regs = (data ?? []) as Reg[];
  const trips = (tripData ?? []) as Pick<EventTrip, "id" | "label">[];
  const unitName = new Map((unitData ?? []).map((u) => [u.id, u.name]));
  const legs = new Map<string, Leg>();
  for (const l of legData ?? []) {
    legs.set(`${l.registration_id}:${l.direction}`, {
      mode: l.mode as TransportMode,
      status: l.status as TransportStatus,
      via: l.via_unit_id ? unitName.get(l.via_unit_id) ?? null : null,
    });
  }
  const legOf = (r: Reg, dir: "up" | "down") => legs.get(`${r.id}:${dir}`) ?? null;

  // ── 사유별 묶음 ────────────────────────────────────────────
  // 한 사람이 여러 사유에 걸릴 수 있다. 사유마다 확인할 것이 달라서 양쪽에 넣는다.
  const oneway = regs.filter((r) => r.attendance_type === "oneway");
  const self = regs.filter((r) => r.attendance_type === "self");
  const period = regs.filter((r) => r.attend_from != null || r.attend_to != null);
  // 우리 버스를 안 타는데 무엇으로 오는지도 안 적힌 사람 — 임역원이 가장 먼저
  // 물어봐야 할 사람들이라 맨 위에 둔다.
  const missing = self.filter(
    (r) => !legOf(r, "up") && !legOf(r, "down") && !r.note?.trim()
  );

  const sections = [
    {
      key: "missing",
      title: "무엇으로 오는지 모름",
      hint: "우리 버스를 안 타는데 이동수단도 비고도 없습니다. 먼저 물어봐 주세요",
      rows: missing,
    },
    {
      key: "oneway",
      title: "편도",
      hint: "갈 때나 올 때 한쪽만 우리 버스를 탑니다",
      rows: oneway,
    },
    {
      key: "self",
      title: "개인 이동",
      hint: "우리 버스를 아예 안 탑니다 — 타지구 차량·KTX·자차 등",
      rows: self,
    },
    {
      key: "period",
      title: "며칠만 참석",
      hint: "행사 전체가 아니라 일부 기간만 있습니다. 왕복으로 타더라도 부분참입니다",
      rows: period,
    },
  ].filter((s) => s.rows.length > 0);

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold text-foreground">부분 참석자</h2>
        <p className="text-sm text-muted mt-0.5">
          우리 캠퍼스에서 <b>행사 전체를 우리 버스로 왕복하지 않는</b> 사람들을 사유별로
          묶었습니다. 한 사람이 두 사유에 걸리면 양쪽에 나옵니다. 이동수단·참여기간은
          ‘순장/순원 입력’ 화면에서 고칠 수 있어요.
        </p>
      </div>

      {sections.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted">부분 참석자가 없습니다.</p>
        </Card>
      ) : (
        sections.map((s) => (
          <Card key={s.key} title={s.title} subtitle={`${s.rows.length}명 · ${s.hint}`}>
            <ul className="divide-y divide-border">
              {s.rows.map((r) => {
                const up = legOf(r, "up");
                const down = legOf(r, "down");
                const upB = transportBadge(up?.mode, up?.status, up?.via);
                const downB = transportBadge(down?.mode, down?.status, down?.via);
                return (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-base text-foreground">
                        {r.name}
                        <span className="ml-1.5 text-xs text-muted-2">{r.student_id}</span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {/* 사유마다 **그 사유를 설명하는 값**을 보여준다.
                            며칠만 참석이면 기간이, 편도면 어느 편인지가 답이다. */}
                        {s.key === "period" ? (
                          <Badge variant="primary" dot={false}>
                            {r.attend_from ?? "처음"} ~ {r.attend_to ?? "끝"}
                          </Badge>
                        ) : (
                          <Badge variant="mute" dot={false}>
                            {attendanceSummary(r.up_trip_id, r.down_trip_id, trips)}
                          </Badge>
                        )}
                        {upB && (
                          <Badge variant={upB.tone} dot={false} title={upB.title}>
                            {DIRECTION_SHORT.up.slice(0, 1)} {upB.text}
                          </Badge>
                        )}
                        {downB && (
                          <Badge variant={downB.tone} dot={false} title={downB.title}>
                            {DIRECTION_SHORT.down.slice(0, 1)} {downB.text}
                          </Badge>
                        )}
                      </span>
                    </div>
                    {s.key === "missing" && (
                      <p className="mt-1 text-sm text-warning">
                        이동수단이 비어 있습니다 — {TRANSPORT_LABELS.other_district} ·{" "}
                        {TRANSPORT_LABELS.ktx} · {TRANSPORT_LABELS.own_car} 중 무엇인지
                        확인해 주세요.
                      </p>
                    )}
                    {r.note?.trim() && (
                      <p className="mt-1 text-sm text-muted whitespace-pre-wrap break-words">
                        {r.note}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
