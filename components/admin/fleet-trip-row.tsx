"use client";

import { useConfirmation } from "@/components/ui/use-confirmation";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateTimeField } from "@/components/ui/date-time-field";
import { formatKst, isCompleteDateTime, toKst, toKstInput } from "@/lib/time/kst";
import type { TripRow, TripPatch } from "@/lib/admin/trips";

export function FleetTripRow({
  trip,
  busCount,
  pending,
  onPatch,
  onBusCount,
  onDelete,
}: {
  readonly trip: TripRow;
  readonly busCount: number;
  readonly pending: boolean;
  readonly onPatch: (id: number, patch: TripPatch) => Promise<boolean>;
  readonly onBusCount: (id: number, target: number) => Promise<boolean>;
  readonly onDelete: (id: number) => void;
}) {
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(trip.label);
  const [departsAt, setDepartsAt] = useState(
    trip.departs_at ? toKstInput(trip.departs_at) : ""
  );
  const [busDraft, setBusDraft] = useState(String(busCount));
  const [dateTimeError, setDateTimeError] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      {confirmationDialog}
      {editing ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            운행편 이름
            <input
              disabled={pending}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground w-44 sm:text-sm"
            />
          </label>
          <DateTimeField
            label="출발 일시 (선택)"
            value={departsAt}
            onChange={(value) => {
              setDepartsAt(value);
              setDateTimeError("");
            }}
            disabled={pending}
            error={dateTimeError}
          />
          {/* 이미 있는 편도 대수를 다시 잡을 수 있어야 한다. 편성을 짜다 보면
              "이 편은 9대로" 처럼 바꾸는 일이 잦다.
              늘리면 이 방향이 비어 있는 차부터 채우고, 줄이면 반대 방향도 뛰는 차는
              **이 편에서만 뗀다**(차를 지우면 반대 방향까지 사라진다). */}
          <label
            className="flex items-center gap-1 text-xs text-muted-2"
            title="이 편을 뛰는 총 대수입니다. 늘리면 이 방향이 비어 있는 차부터 채우고, 줄이면 반대 방향도 뛰는 차는 이 편에서만 뗍니다."
          >
            이 편 차량
            <input
              disabled={pending}
              type="number"
              min={0}
              max={30}
              value={busDraft}
              onChange={(e) => setBusDraft(e.target.value)}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground text-right tabular-nums"
            />
            대
          </label>
          <Button
            size="sm"
            disabled={pending || !label.trim()}
            onClick={async () => {
              if (departsAt && !isCompleteDateTime(departsAt)) {
                setDateTimeError("출발 날짜와 시각을 모두 입력하거나 둘 다 비워 주세요.");
                return;
              }
              const saved = await onPatch(trip.id, {
                label,
                departsAt: toKst(departsAt),
              });
              if (!saved) return;
              const next = Math.max(0, Math.min(30, Number(busDraft) || 0));
              if (next !== busCount && !(await onBusCount(trip.id, next))) return;
              setEditing(false);
            }}
          >
            저장
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
            취소
          </Button>
        </>
      ) : (
        <>
          <span className="font-medium text-sm">{trip.label}</span>
          {/* 시각을 안 넣어도 운영에 지장이 없다 — 편 이름이 시각을 담고 있고,
              배차·수송 보드는 이 값을 읽지 않는다. 그래서 비어 있을 때 "미정" 이라고
              결함처럼 적지 않는다(있으면 보여주고, 없으면 조용히 넘어간다). */}
          {trip.departs_at && (
            <span className="text-xs text-muted-2">{formatKst(trip.departs_at)}</span>
          )}
          {!trip.active && <Badge variant="mute">비활성</Badge>}
          <Badge variant={busCount === 0 ? "mute" : "primary"}>
            차량 {busCount}대
          </Badge>
          <span className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setLabel(trip.label);
                setDepartsAt(toKstInput(trip.departs_at));
                setBusDraft(String(busCount));
                setDateTimeError("");
                setEditing(true);
              }}
            >
              수정
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => onPatch(trip.id, { active: !trip.active })}
            >
              {trip.active ? "비활성" : "활성"}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={async () => {
                if (
                  (await requestConfirmation({ title: "운행편을 삭제할까요?", description: `"${trip.label}" 운행편을 지웁니다.\n차량이나 신청이 물려 있으면 거부됩니다.`, confirmLabel: "운행편 삭제", tone: "danger" }))
                )
                  onDelete(trip.id);
              }}
            >
              삭제
            </Button>
          </span>
        </>
      )}
    </div>
  );
}
