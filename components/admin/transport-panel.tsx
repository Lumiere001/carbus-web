"use client";

import { useConfirmation } from "@/components/ui/use-confirmation";

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
  otherRows,
  canConfirm,
}: {
  /** 확정 대기 중인 타지구 이용 */
  pending: LegRow[];
  /** 확정인데 아직 좌석을 잡고 있는 모순 상태 */
  confirmedHolding: LegRow[];
  /**
   * 우리 버스가 아닌 나머지(KTX·고속버스 · 자차·가족차 · 기타).
   * 확정을 기다리는 개념은 없지만 **누가 그렇게 오는지**는 알아야 한다 —
   * 출발 인원에서 빠지고, 도착 시각을 따로 물어야 하는 사람들이다.
   */
  otherRows: LegRow[];
  canConfirm: boolean;
}) {
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const heldSeats = (rows: LegRow[]) =>
    rows.filter((r) => r.heldTripLabel != null || r.heldBusLabel != null).length;

  async function run(rows: LegRow[], what: string) {
    const seats = heldSeats(rows);
    const msg =
      (seats > 0
        ? `${what} ${rows.length}건을 확정하면 우리 버스 ${seats}석을 반납하고 편·배정 호차를 비웁니다.\n\n되돌리려면 편을 지정하고 배차를 다시 실행하세요.`
        : `${what} ${rows.length}건을 확정합니다.\n\n현재 잡힌 좌석이 없어 반납되는 자리는 없습니다.`);
    if (!(await requestConfirmation({ title: "이동수단을 확정할까요?", description: msg, confirmLabel: "이동수단 확정", tone: seats > 0 ? "danger" : "default" }))) return;

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
  const upCount = [...pending, ...confirmedHolding, ...otherRows].filter((row) => row.direction === "up").length;
  const downCount = pending.length + confirmedHolding.length + otherRows.length - upCount;

  return (
    <div className="space-y-6">
      {confirmationDialog}
      {err && (
        <div role="alert" className="text-sm rounded-lg px-3 py-2 border bg-danger-bg border-danger-border text-danger">
          {err}
        </div>
      )}

      <Card title="확인할 이동" subtitle="확정 대기·좌석 점검·개별 이동 목록의 집계 · 한 방향은 1건">
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
          {[{ label: "상행 확인 대상", value: upCount, unit: "건" }, { label: "하행 확인 대상", value: downCount, unit: "건" }, { label: "확정 대기", value: pending.length, unit: "건" }, { label: "대기 중 점유 좌석", value: totalHeld, unit: "석" }].map((item) => <div key={item.label} className="min-w-0"><p className="text-sm text-muted">{item.label}</p><p className="mt-2 font-mono text-2xl tabular-nums text-foreground">{item.value}<span className="ml-1 font-sans text-sm text-muted">{item.unit}</span></p></div>)}
        </div>
      </Card>
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
          <LegList rows={confirmedHolding} showWait={false} />
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
            <LegList
              rows={rows}
              showWait
              onConfirm={canConfirm ? (r) => run([r], r.personName) : undefined}
              busy={busy}
            />
          </Card>
        );
      })}

      {/* 우리 버스가 아닌 나머지 — 수단별로 묶어 **명단까지** 보여준다.
          숫자만 있으면 "그래서 누구?" 에서 막힌다. */}
      {otherRows.length > 0 && (
        <Card
          title="우리 버스를 안 타는 사람들"
          subtitle="KTX·고속버스 · 자차·가족차 · 기타 — 확정을 기다리는 개념은 없지만 누가 그렇게 오는지는 알아야 합니다"
        >
          <div className="px-5 py-3 flex flex-wrap gap-x-5 gap-y-1 text-sm border-b border-border">
            {[...new Set(otherRows.map((r) => r.mode))].map((mode) => {
              const rows = otherRows.filter((r) => r.mode === mode);
              const holding = heldSeats(rows);
              return (
                <span key={mode} className="text-muted">
                  {TRANSPORT_LABELS[mode]}{" "}
                  <b className="text-foreground tabular-nums">{rows.length}</b>건
                  {holding > 0 && (
                    <span className="text-warning"> (좌석 {holding}석 점유)</span>
                  )}
                </span>
              );
            })}
          </div>
          {/* 수단마다 **띠로 확실히 가른다.**
              예전엔 작은 회색 글씨 한 줄이 앞 묶음의 마지막 사람 바로 밑에 붙어서,
              `KTX·고속버스` 가 그 위 사람(자차로 오는 사람)의 정보처럼 읽혔다.
              굵은 구분선 + 배경 띠 + 건수로, 여기서부터 다른 수단이라는 게 보이게 한다. */}
          {[...new Set(otherRows.map((r) => r.mode))].map((mode) => {
            const rows = otherRows.filter((r) => r.mode === mode);
            return (
              <section
                key={mode}
                className="border-t-4 border-border first:border-t-0"
                aria-label={`${TRANSPORT_LABELS[mode]} 이용자`}
              >
                <div className="px-5 py-2.5 bg-surface-2 flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">
                    {TRANSPORT_LABELS[mode]}
                  </h4>
                  <Badge variant="mute" dot={false}>
                    {rows.length}건
                  </Badge>
                </div>
                <LegList rows={rows} showWait={false} />
              </section>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function LegList({
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
  return <ul className="divide-y divide-border">{rows.map((row) => {
    const held = [row.heldTripLabel, row.heldBusLabel].filter(Boolean).join(" · ");
    return <li key={row.id} className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start sm:px-5">
      <div className="min-w-0">
        <p className="break-words text-base font-medium text-foreground">{row.personName}<span className="ml-2 text-sm font-normal text-muted">{row.campusName}</span></p>
        <p className="mt-1 text-sm text-muted">{DIR_LABEL[row.direction]}</p>
        {showWait && <p className="mt-2 text-sm text-warning">확정 대기 {row.daysWaiting}일</p>}
      </div>
      <div className="min-w-0 space-y-2">
        <p className={`break-words text-sm ${held ? "text-warning" : "text-muted-2"}`}>우리 버스 자리 · {held || "점유 없음"}</p>
        <p className="break-words whitespace-pre-wrap text-sm text-muted"><span className="text-muted-2">메모 · </span>{row.note ?? "—"}</p>
      </div>
      {onConfirm && <Button size="sm" variant="secondary" disabled={busy} aria-label={`${row.personName} ${row.direction === "up" ? "상행" : "하행"} 이동수단 확정`} onClick={() => onConfirm(row)}>확정</Button>}
    </li>;
  })}</ul>;
}
