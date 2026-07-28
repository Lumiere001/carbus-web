"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { tripLabel } from "@/lib/labels";
import type { EventTrip } from "@/lib/supabase/types";
import { assignDriverBus, assignFixedBus } from "@/lib/admin/leaders";
import { ROLE_DRIVER, ROLE_FIXED } from "@/lib/roles/special";

export type LeaderRow = {
  id: string;
  name: string;
  student_id: string;
  campus_name: string;
  /** 표시용 역할 배지 (총단·간사 등 + 파생된 차량순장/고정). */
  roleBadges: string[];
  /** 새 방향 결박 시 기본 종류. 일반 역할만 있으면 null(호차 칸 비활성). */
  primaryKind: "driver" | "fixed" | null;
  up_trip_id: number | null;
  /** 3-C 이후 하행도 편을 신청한다 — 호차 후보를 이 편으로 거른다. */
  down_trip_id: number | null;
  ridesUp: boolean;
  ridesDown: boolean;
  /** 방향별 현재 바인딩 종류 (없으면 null). */
  upKind: "driver" | "fixed" | null;
  downKind: "driver" | "fixed" | null;
  upBusId: number | null;
  downBusId: number | null;
  needUp: boolean;
  needDown: boolean;
};
/** ⚠️ 편 컬럼은 선택 필드로 만들지 마라 — 커밋 ab31181 의 교훈(드롭다운이 통째로 비었다). */
export type BusOpt = {
  id: number;
  name: string;
  up_trip_id: number | null;
  down_trip_id: number | null;
  /**
   * 차량 종류 (§26-E). 이 화면이 **간사 차량 탑승자를 지정하는 유일한 통로**다 —
   * 자동 배차는 간사 차를 건드리지 않으므로, 여기서 고정 탑승자로 넣지 않으면
   * 그 사람이 어디에 탔는지가 아무 데도 안 남는다.
   */
  kind: "bus" | "staff_car";
};

function badgeVariant(role: string): "warning" | "primary" | "mute" {
  if (role === ROLE_DRIVER) return "warning";
  if (role === ROLE_FIXED) return "primary";
  return "mute";
}

export function LeadersPanel({
  leaders,
  buses,
  trips,
  isMaster,
}: {
  leaders: LeaderRow[];
  buses: BusOpt[];
  trips: Pick<EventTrip, "id" | "label">[];
  isMaster: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const needCount = leaders.filter((l) => l.needUp || l.needDown).length;

  function assign(
    row: LeaderRow,
    mode: "up" | "down",
    cellKind: "driver" | "fixed",
    value: string
  ) {
    const busId = value ? Number(value) : null;
    startTransition(async () => {
      const fn = cellKind === "driver" ? assignDriverBus : assignFixedBus;
      const res = await fn(row.id, busId, mode);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setMsg({
        type: "ok",
        text: `${row.name} ${mode === "up" ? "상행" : "하행"} 호차 ${busId ? "지정" : "해제"}`,
      });
      router.refresh();
    });
  }

  const busCell = (row: LeaderRow, mode: "up" | "down") => {
    const rides = mode === "up" ? row.ridesUp : row.ridesDown;
    const cur = mode === "up" ? row.upBusId : row.downBusId;
    const need = mode === "up" ? row.needUp : row.needDown;
    // 이 방향의 결박 종류 (없으면 기본 종류로 새로 결박)
    const cellKind =
      (mode === "up" ? row.upKind : row.downKind) ?? row.primaryKind ?? "fixed";

    // 이 방향에 간사 차량이 있는가 (§26-E).
    //
    // 간사 차를 타는 사람은 **우리 버스 편을 신청하지 않은 경우가 대부분**이다 —
    // 크루·미디어는 간사님 차로 이동한다. 그래서 `rides`(그 편 신청 여부)로
    // 잘라 버리면 이 화면에서 간사 차 탑승자를 지정할 방법이 아예 없어진다.
    // 실제로 리허설에서 그 막다른 길이 나왔다.
    const staffCars = buses.filter(
      (b) => b.kind === "staff_car" && (mode === "up" ? b.up_trip_id : b.down_trip_id) != null
    );
    // 우리 버스도 안 타고 이 방향에 간사 차도 없으면 지정할 대상이 없다.
    // (예전엔 "차량순장·고정탑승이 아니면 무조건 —" 이었는데, 그러면 크루·미디어를
    //  간사 차에 태울 방법이 아예 없다. 역할을 주려면 배정이 있어야 하고, 배정을
    //  하려면 역할이 있어야 하는 순환이었다.)
    if (!rides && staffCars.length === 0)
      return <span className="text-muted-2">해당 없음</span>;
    if (row.primaryKind == null && !rides && cur == null && staffCars.length === 0)
      return <span className="text-muted-2">—</span>;
    // 서버(leaders.ts assertTripMatch)가 허용하는 집합과 **정확히 같아야** 한다.
    // 예전엔 하행이 전 호차였다 — 그때는 서버도 하행을 안 봤지만, 3-C 이후엔
    // 서버가 편을 검사하므로 목록에는 뜨는데 저장은 거부되는 상태가 된다.
    // 현재 지정된 호차는 편이 어긋나도 남긴다(사라지면 select 표시가 깨진다).
    const regTrip = mode === "up" ? row.up_trip_id : row.down_trip_id;
    const opts = buses.filter((b) => {
      if (b.id === cur) return true;
      const busTrip = mode === "up" ? b.up_trip_id : b.down_trip_id;
      if (busTrip == null) return false;
      // 간사 차량은 **우리 버스 편과 짝을 맞추지 않는다.** 우리 버스를 안 타는
      // 사람이 타는 차라 편을 신청하지 않았을 수 있다. 서버도 같은 규칙이다
      // (leaders.ts assertTripMatch) — 여기가 더 엄격하면 지정할 길이 없어지고,
      // 더 느슨하면 저장이 거부된다.
      if (b.kind === "staff_car") return true;
      return regTrip != null && busTrip === regTrip;
    });
    if (!isMaster) {
      const b = buses.find((x) => x.id === cur);
      return (
        <span className={need ? "text-warning font-medium" : "text-foreground"}>
          {b ? b.name : "미지정"}
        </span>
      );
    }
    return (
      <select
        value={cur ?? ""}
        disabled={pending}
        onChange={(e) => assign(row, mode, cellKind, e.target.value)}
        className={
          "text-xs border rounded-md px-2 py-1 bg-surface " +
          (need ? "border-warning-border text-warning" : "border-border-2")
        }
      >
        <option value="">미지정</option>
        {opts.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.kind === "staff_car" ? " · 간사 차량" : ""} (
            {tripLabel(mode === "up" ? b.up_trip_id : b.down_trip_id, trips)})
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">리더 관리</h2>
        <p className="text-sm text-muted mt-0.5">
          역할(총단·간사·차량순장·고정탑승)이 있는 순장/순원을 모아 봅니다. 차량순장·고정탑승은
          전체 순장/순원 화면에서 역할을 주면 현재 배정 호차에 자동으로 묶이며, 여기서 호차를
          바꿀 수 있습니다.
        </p>
      </div>

      {msg && (
        <div
          className={
            "text-sm rounded-lg px-3 py-2 border " +
            (msg.type === "err"
              ? "bg-danger-bg border-danger-border text-danger"
              : "bg-success-bg border-success-border text-success")
          }
        >
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted">
          리더 <b className="text-foreground tabular-nums">{leaders.length}</b>
        </span>
        <span className={needCount > 0 ? "text-warning" : "text-muted-2"}>
          호차 미지정 <b className="tabular-nums">{needCount}</b>
        </span>
      </div>

      {needCount > 0 && (
        <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning flex items-start gap-2">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            호차가 지정되지 않은 차량순장·고정탑승이 <b>{needCount}명</b> 있습니다. 배차를
            실행하려면 먼저 이들의 호차를 모두 지정해야 합니다.
          </span>
        </div>
      )}

      <Card title="리더 목록" subtitle="차량순장·고정탑승은 호차 지정 가능">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">이름</th>
                <th className="px-4 py-2.5">캠퍼스 · 학번</th>
                <th className="px-4 py-2.5">역할</th>
                <th className="px-4 py-2.5">상행 호차</th>
                <th className="px-4 py-2.5">하행 호차</th>
              </tr>
            </thead>
            <tbody>
              {leaders.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted-2 py-6">
                    역할이 부여된 사람이 없습니다. (전체 순장/순원 화면에서 역할을 부여하세요)
                  </td>
                </tr>
              )}
              {leaders.map((l) => (
                <tr
                  key={l.id}
                  className={"border-t border-border " + (l.needUp || l.needDown ? "bg-warning-bg/40" : "")}
                >
                  <td className="px-4 py-2 text-foreground whitespace-nowrap">{l.name}</td>
                  <td className="px-4 py-2 text-muted-2 whitespace-nowrap">
                    {l.campus_name} · {l.student_id}
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {l.roleBadges.map((role) => (
                        <Badge key={role} variant={badgeVariant(role)}>
                          {role}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2">{busCell(l, "up")}</td>
                  <td className="px-4 py-2">{busCell(l, "down")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
