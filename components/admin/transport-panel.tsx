"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TriangleAlert, Check } from "lucide-react";
import { confirmLegs } from "@/lib/admin/transport";
import {
  DIRECTION_LABELS,
  TRANSPORT_LABELS,
  type TransportMode,
  type TransportStatus,
} from "@/lib/transport/labels";

export type LegRow = {
  id: number;
  registrationId: string;
  personName: string;
  campusName: string;
  direction: "up" | "down";
  mode: TransportMode;
  status: TransportStatus;
  viaUnitName: string | null;
  note: string | null;
  daysWaiting: number;
  /** 이 방향으로 지금 잡고 있는 운행편·호차 이름. 없으면 좌석을 안 쓰는 중. */
  heldTripLabel: string | null;
  heldBusLabel: string | null;
};

// 방향 문구는 `lib/transport/labels` 한 곳에서 만든다 (§26-C).
const DIR_LABEL = DIRECTION_LABELS;

/**
 * 외부수단 확정 관리 (§11-C 의 E).
 *
 * 왜 이 화면이 필요한가: "타지구 차를 얻어 타기로 했는데 아직 확정이 안 났다"는
 * 사람들의 좌석을 **우리가 계속 잡아두고 있다**. 확정이 나면 놓아줘야 하는데,
 * 지금까지는 그 사실이 어디에도 모이지 않아 아무도 놓지 않았다. 그래서
 * 빈 좌석을 태우고 출발한다.
 *
 * 확정을 누르면 DB 트리거가 그 방향의 편과 배정 호차를 **자동으로 비운다**(§11-C C).
 * 되돌리려면 재배차해야 하므로, 이 화면의 모든 확정 버튼은 확인을 받고 부른다.
 */
export function TransportPanel({
  pending,
  confirmedHolding,
  otherModes,
  canConfirm,
}: {
  /** 확정 대기 중인 타지구 이용 */
  pending: LegRow[];
  /** 확정인데 아직 좌석을 잡고 있는 모순 상태 */
  confirmedHolding: LegRow[];
  /** KTX·자차 등 — 대기 개념이 없어 집계만 */
  otherModes: { mode: TransportMode; count: number; holding: number }[];
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const heldSeats = (rows: LegRow[]) =>
    rows.filter((r) => r.heldTripLabel != null || r.heldBusLabel != null).length;

  function run(rows: LegRow[], what: string) {
    const seats = heldSeats(rows);
    const msg =
      `${what} ${rows.length}건을 확정합니다.\n\n` +
      (seats > 0
        ? `우리 버스 좌석 ${seats}석이 그 자리에서 반납됩니다 (편·배정 호차가 함께 비워집니다).\n` +
          `되돌리려면 편을 다시 지정하고 배차를 다시 실행해야 합니다.\n\n`
        : `지금 잡고 있는 좌석은 없어 반납되는 자리는 없습니다.\n\n`) +
      `진행할까요?`;
    if (!window.confirm(msg)) return;

    setErr(null);
    startTransition(async () => {
      const res = await confirmLegs(rows.map((r) => r.id));
      if (!res.ok) return setErr(res.message);
      router.refresh();
    });
  }

  // 지구별로 묶는다 — 확정 연락은 지구 담당자 한 명에게 한 번에 하게 된다.
  const groups = new Map<string, LegRow[]>();
  for (const r of pending) {
    const key = r.viaUnitName ?? "지구 미지정";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  // 오래 기다린 지구가 위로. 확정 관리의 우선순위는 곧 경과일이다.
  const ordered = [...groups.entries()].sort(
    (a, b) =>
      Math.max(...b[1].map((r) => r.daysWaiting)) -
      Math.max(...a[1].map((r) => r.daysWaiting))
  );

  const totalHeld = heldSeats(pending);

  return (
    <div className="space-y-6">
      {err && (
        <div className="text-sm rounded-lg px-3 py-2 border bg-danger-bg border-danger-border text-danger">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted">
          확정 대기 <b className="text-foreground tabular-nums">{pending.length}</b>건
        </span>
        <span className={totalHeld > 0 ? "text-warning" : "text-muted-2"}>
          잡아둔 좌석 <b className="tabular-nums">{totalHeld}</b>석
        </span>
        <span className="text-muted">
          지구 <b className="text-foreground tabular-nums">{groups.size}</b>곳
        </span>
      </div>

      {confirmedHolding.length > 0 && (
        <Card
          title="확정인데 좌석을 잡고 있습니다"
          subtitle="확정을 먼저 등록하고 나중에 편을 지정한 경우입니다 — 편 지정은 막지 않습니다"
        >
          <div className="px-5 py-3 text-sm text-warning flex items-start gap-2 border-b border-border">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>
              이 {confirmedHolding.length}건은 타지구 차량이 확정됐는데도 우리 버스 자리를
              차지하고 있습니다. 명단 화면에서 그 방향의 <b>편을 비우거나</b>, 실제로 우리
              버스를 탄다면 이동수단을 고쳐 주세요.
            </span>
          </div>
          <LegTable rows={confirmedHolding} showWait={false} />
        </Card>
      )}

      {pending.length === 0 && (
        <Card className="p-5">
          <p className="text-sm text-muted">
            확정을 기다리는 타지구 차량이 없습니다. ✓
          </p>
        </Card>
      )}

      {ordered.map(([unit, rows]) => {
        const seats = heldSeats(rows);
        const oldest = Math.max(...rows.map((r) => r.daysWaiting));
        return (
          <Card
            key={unit}
            title={unit}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={oldest >= 7 ? "warning" : "mute"} dot={false}>
                  {rows.length}건 · 최장 {oldest}일째
                </Badge>
                <span>잡아둔 좌석 {seats}석</span>
              </span>
            }
            action={
              canConfirm && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => run(rows, unit)}
                >
                  <Check size={14} /> 모두 확정
                </Button>
              )
            }
          >
            <LegTable
              rows={rows}
              showWait
              onConfirm={canConfirm ? (r) => run([r], r.personName) : undefined}
              busy={busy}
            />
          </Card>
        );
      })}

      {otherModes.length > 0 && (
        <Card
          title="그 밖의 이동수단"
          subtitle="KTX·자차 등은 확정을 기다리는 개념이 없어 집계만 합니다"
        >
          <div className="px-5 py-3 flex flex-wrap gap-4 text-sm">
            {otherModes.map((m) => (
              <span key={m.mode} className="text-muted">
                {TRANSPORT_LABELS[m.mode]}{" "}
                <b className="text-foreground tabular-nums">{m.count}</b>건
                {m.holding > 0 && (
                  <span className="text-warning">
                    {" "}
                    (좌석 {m.holding}석 점유)
                  </span>
                )}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function LegTable({
  rows,
  showWait,
  onConfirm,
  busy,
}: {
  rows: LegRow[];
  showWait: boolean;
  onConfirm?: (r: LegRow) => void;
  busy?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
            <th className="px-4 py-2.5">이름</th>
            <th className="px-4 py-2.5">방향</th>
            <th className="px-4 py-2.5">잡고 있는 자리</th>
            {showWait && <th className="px-4 py-2.5">기다린 날</th>}
            <th className="px-4 py-2.5">메모</th>
            {onConfirm && <th className="px-4 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const held = [r.heldTripLabel, r.heldBusLabel]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2 text-foreground whitespace-nowrap">
                  {r.personName}
                  <span className="ml-1.5 text-xs text-muted-2">{r.campusName}</span>
                </td>
                <td className="px-4 py-2 text-muted whitespace-nowrap">
                  {DIR_LABEL[r.direction]}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {held ? (
                    <span className="text-warning font-medium">{held}</span>
                  ) : (
                    <span className="text-muted-2">—</span>
                  )}
                </td>
                {showWait && (
                  <td className="px-4 py-2 text-muted-2 tabular-nums whitespace-nowrap">
                    {r.daysWaiting}일
                  </td>
                )}
                <td className="px-4 py-2 text-muted-2">{r.note ?? "—"}</td>
                {onConfirm && (
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onConfirm(r)}
                    >
                      확정
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
