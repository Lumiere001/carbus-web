"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { isCompleteDateTime, toKst } from "@/lib/time/kst";
import type { TripRow, TripDirection, TripPatch } from "@/lib/admin/trips";
import type { BusRow } from "@/lib/admin/buses";
import { FleetTripRow } from "./fleet-trip-row";

const DIRECTION_LABEL: Record<TripDirection, string> = {
  up: "상행 (가는 편)",
  down: "하행 (오는 편)",
};

/** 문장 안에 넣는 짧은 이름. "상행 편이 비어 있는 1호차" 처럼 쓴다. */
const DIRECTION_NOUN: Record<TripDirection, string> = { up: "상행", down: "하행" };

export function FleetTripSection({
  direction,
  trips,
  buses,
  pending,
  onCreate,
  onPatch,
  onBusCount,
  onDelete,
}: {
  readonly direction: TripDirection;
  readonly trips: readonly TripRow[];
  readonly buses: readonly BusRow[];
  readonly pending: boolean;
  readonly onCreate: (label: string, departsAt: string | null, busCount: number) => Promise<boolean>;
  readonly onBusCount: (id: number, target: number) => Promise<boolean>;
  readonly onPatch: (id: number, patch: TripPatch) => Promise<boolean>;
  readonly onDelete: (id: number) => void;
}) {
  const [label, setLabel] = useState("");
  const [departsAt, setDepartsAt] = useState("");
  const [busCountDraft, setBusCountDraft] = useState("0");
  const [dateTimeError, setDateTimeError] = useState("");

  /** 지금까지 쓰인 가장 큰 호차 번호. 새 차량은 그 다음부터 이어 붙는다. */
  const lastBusNo = buses.reduce((m, b) => {
    const n = Number(/^(\d+)호차$/.exec(b.name ?? "")?.[1] ?? 0);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);

  /**
   * 이 방향이 비어 있는 차 — 새로 만들기 전에 **먼저 채워지는** 차들이다.
   * 화면에 이름까지 보여준다. 안 그러면 "3대" 를 넣었을 때 새 차가 3대 생기는지
   * 있던 차가 쓰이는지 눌러 보기 전엔 알 수 없다(그래서 6대가 됐다).
   */
  const freeBuses = [...buses]
    .filter((b) => b.kind === "bus")
    .filter((b) => (direction === "up" ? b.up_trip_id : b.down_trip_id) === null)
    .sort((a, b) => a.display_order - b.display_order || a.id - b.id);

  // 간사 차량은 이 대수에 안 들어간다 (§26-E) — `setTripBusCount` 와 같은 기준이다.
  // 화면이 4대라고 하는데 저장 로직은 3대로 세면, 4를 그대로 저장하는 것만으로
  // 버스가 한 대 늘어난다.
  const busCount = (tripId: number) =>
    buses.filter(
      (b) =>
        b.kind === "bus" &&
        (direction === "up" ? b.up_trip_id === tripId : b.down_trip_id === tripId)
    ).length;

  return (
    <Card
      title={DIRECTION_LABEL[direction]}
      subtitle={"출발 시각과 편성을 여기서 정합니다. 상·하행의 입력\u00a0방식은\u00a0같습니다."}
    >
      <div className="px-5 py-4 flex flex-col gap-3">
        {trips.length === 0 && (
          <p className="text-sm text-muted-2">아직 운행편이 없습니다.</p>
        )}

        {trips.map((t) => (
          <FleetTripRow
            key={t.id}
            trip={t}
            busCount={busCount(t.id)}
            pending={pending}
            onPatch={onPatch}
            onBusCount={onBusCount}
            onDelete={onDelete}
          />
        ))}

        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border">
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            새 운행편 이름
            <input
              disabled={pending}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={direction === "up" ? "예: 화 오전 9시" : "예: 일 오후 3시"}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground w-48"
            />
          </label>
          {/* 차량 대수를 여기서 같이 받는다. 편만 만들면 차가 0대라 아무도 못 타는데,
              지금까지는 아래 차량 섹션으로 내려가 한 대씩 따로 추가해야 했다 —
              편성을 처음 짤 때 반드시 이어서 하는 일이다.

              라벨이 그냥 "차량 대수" 였을 때 **새로 만드는 대수인지 그 편을 뛰는 총
              대수인지** 알 수 없었다. 총 대수다 — 이미 있는 차부터 채운다. */}
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            이 편을 뛸 차량 대수
            <input
              disabled={pending}
              type="number"
              min={0}
              max={30}
              value={busCountDraft}
              onChange={(e) => setBusCountDraft(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground w-24 text-right tabular-nums"
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
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !label.trim()}
            onClick={async () => {
              if (departsAt && !isCompleteDateTime(departsAt)) {
                setDateTimeError("출발 날짜와 시각을 모두 입력하거나 둘 다 비워 주세요.");
                return;
              }
              const saved = await onCreate(
                label,
                toKst(departsAt),
                Math.max(0, Math.min(30, Number(busCountDraft) || 0))
              );
              if (!saved) return;
              setLabel("");
              setDepartsAt("");
              setDateTimeError("");
              setBusCountDraft("0");
            }}
          >
            추가
          </Button>
          <p className="w-full text-xs text-muted-2 leading-snug">
            {freeBuses.length > 0 ? (
              <>
                {DIRECTION_NOUN[direction]} 편이 비어 있는{" "}
                <b>
                  {freeBuses
                    .slice(0, 3)
                    .map((b) => b.name)
                    .join("·")}
                  {freeBuses.length > 3 ? ` 외 ${freeBuses.length - 3}대` : ""}
                </b>
                부터 채우고, 모자라면 <b>{lastBusNo + 1}호차</b>부터 새로 만듭니다.
                그래서 상행 3대·하행 3대로 지정하면 <b>같은 3대가 왕복</b>합니다.
              </>
            ) : (
              <>
                {DIRECTION_NOUN[direction]} 편이 비어 있는 차가 없어{" "}
                <b>{lastBusNo + 1}호차</b>부터 새로 만들어집니다. 이름이 겹치면 현장에서
                “몇 호차 타세요”가 통하지 않습니다.
              </>
            )}
            {" "}출발 일시는 비워도 됩니다 — 지금은 편 이름의 시각으로 운영합니다.
          </p>
        </div>
      </div>
    </Card>
  );
}
