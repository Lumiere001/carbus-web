"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createTripWithBuses,
  setTripBusCount,
  updateTrip,
  deleteTrip,
  type TripRow,
  type TripDirection,
} from "@/lib/admin/trips";
import {
  createBus,
  updateBus,
  deleteBus,
  type BusRow,
} from "@/lib/admin/buses";

/** 차량별 현재 배정 인원. 삭제 위험을 화면에서 미리 보여주기 위해 함께 받는다. */
export type BusLoad = { up: number; down: number };

type Props = {
  trips: TripRow[];
  buses: BusRow[];
  loads: Record<number, BusLoad>;
  /** 차량 id → 그 차에 배정된 사람들이 **신청한 상행 편** id 목록 (중복 제거). */
  upRequests: Record<number, number[]>;
  /** 하행도 같다. 3-C 로 신청이 하행 편을 갖게 되면서 DB 가드가 대칭이 됐다. */
  downRequests: Record<number, number[]>;
};

const DIRECTION_LABEL: Record<TripDirection, string> = {
  up: "상행 (가는 편)",
  down: "하행 (오는 편)",
};

export function FleetPanel({
  trips,
  buses,
  loads,
  upRequests,
  downRequests,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg(null);
        router.refresh();
      } else {
        setMsg({ kind: "err", text: r.message ?? "실패했습니다." });
      }
    });
  };

  const tripsOf = (d: TripDirection) =>
    trips
      .filter((t) => t.direction === d)
      .sort((a, b) => a.display_order - b.display_order || a.id - b.id);

  const tripLabel = (id: number | null) =>
    id === null ? "—" : (trips.find((t) => t.id === id)?.label ?? `편 ${id}`);

  return (
    <div className="flex flex-col gap-6">
      {msg && (
        <div
          role="alert"
          className={
            msg.kind === "err"
              ? "rounded-lg border border-danger-300 bg-danger-50 px-4 py-3 text-sm text-danger-700"
              : "rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm"
          }
        >
          {msg.text}
        </div>
      )}

      {(["up", "down"] as const).map((dir) => (
        <TripSection
          key={dir}
          direction={dir}
          trips={tripsOf(dir)}
          buses={buses}
          pending={pending}
          onCreate={(label, departsAt, busCount) =>
            run(() =>
              createTripWithBuses({ direction: dir, label, departsAt }, busCount)
            )
          }
          onPatch={(id, patch) => run(() => updateTrip(id, patch))}
          onBusCount={(id, target) => run(() => setTripBusCount(id, dir, target))}
          onDelete={(id) => run(() => deleteTrip(id))}
        />
      ))}

      <BusSection
        buses={buses}
        trips={trips}
        loads={loads}
        upRequests={upRequests}
        downRequests={downRequests}
        pending={pending}
        tripLabel={tripLabel}
        onCreate={(input) => run(() => createBus(input))}
        onPatch={(id, patch) => run(() => updateBus(id, patch))}
        onDelete={(id) => run(() => deleteBus(id))}
      />
    </div>
  );
}

// ── 운행편 ─────────────────────────────────────────────────────

function TripSection({
  direction,
  trips,
  buses,
  pending,
  onCreate,
  onPatch,
  onBusCount,
  onDelete,
}: {
  direction: TripDirection;
  trips: TripRow[];
  buses: BusRow[];
  pending: boolean;
  onCreate: (label: string, departsAt: string | null, busCount: number) => void;
  onBusCount: (id: number, target: number) => void;
  onPatch: (id: number, patch: Parameters<typeof updateTrip>[1]) => void;
  onDelete: (id: number) => void;
}) {
  const [label, setLabel] = useState("");
  const [departsAt, setDepartsAt] = useState("");
  const [busCountDraft, setBusCountDraft] = useState("0");

  /** 지금까지 쓰인 가장 큰 호차 번호. 새 차량은 그 다음부터 이어 붙는다. */
  const lastBusNo = buses.reduce((m, b) => {
    const n = Number(/^(\d+)호차$/.exec(b.name ?? "")?.[1] ?? 0);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);

  const busCount = (tripId: number) =>
    buses.filter((b) =>
      direction === "up" ? b.up_trip_id === tripId : b.down_trip_id === tripId
    ).length;

  return (
    <Card
      title={DIRECTION_LABEL[direction]}
      subtitle="출발 시각과 편성을 여기서 정합니다. 상·하행은 완전히 같은 구조입니다."
    >
      <div className="px-5 py-4 flex flex-col gap-3">
        {trips.length === 0 && (
          <p className="text-sm text-muted-2">아직 운행편이 없습니다.</p>
        )}

        {trips.map((t) => (
          <TripRowItem
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
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={direction === "up" ? "예: 화 오전 9시" : "예: 일 오후 3시"}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg w-48"
            />
          </label>
          {/* 차량 대수를 여기서 같이 받는다. 편만 만들면 차가 0대라 아무도 못 타는데,
              지금까지는 아래 차량 섹션으로 내려가 한 대씩 따로 추가해야 했다 —
              편성을 처음 짤 때 반드시 이어서 하는 일이다. */}
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            차량 대수
            <input
              type="number"
              min={0}
              max={30}
              value={busCountDraft}
              onChange={(e) => setBusCountDraft(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg w-24 text-right tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            출발 일시 (선택)
            <input
              type="datetime-local"
              value={departsAt}
              onChange={(e) => setDepartsAt(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !label.trim()}
            onClick={() => {
              onCreate(
                label,
                departsAt ? new Date(departsAt).toISOString() : null,
                Math.max(0, Math.min(30, Number(busCountDraft) || 0))
              );
              setLabel("");
              setDepartsAt("");
              setBusCountDraft("0");
            }}
          >
            추가
          </Button>
          <p className="w-full text-[11px] text-muted-2 leading-snug">
            차량은 <b>{lastBusNo + 1}호차</b>부터 이어서 만들어집니다. 이름이 겹치면
            현장에서 “몇 호차 타세요”가 통하지 않습니다.
            {" "}출발 일시는 비워도 됩니다 — 지금은 편 이름의 시각으로 운영합니다.
          </p>
        </div>
      </div>
    </Card>
  );
}

function TripRowItem({
  trip,
  busCount,
  pending,
  onPatch,
  onBusCount,
  onDelete,
}: {
  trip: TripRow;
  busCount: number;
  pending: boolean;
  onPatch: (id: number, patch: Parameters<typeof updateTrip>[1]) => void;
  onBusCount: (id: number, target: number) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(trip.label);
  const [departsAt, setDepartsAt] = useState(
    trip.departs_at ? toLocalInput(trip.departs_at) : ""
  );
  const [busDraft, setBusDraft] = useState(String(busCount));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      {editing ? (
        <>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg w-44"
          />
          <input
            type="datetime-local"
            value={departsAt}
            onChange={(e) => setDepartsAt(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
          />
          {/* 이미 있는 편도 대수를 다시 잡을 수 있어야 한다. 편성을 짜다 보면
              "이 편은 9대로" 처럼 바꾸는 일이 잦다. */}
          <label className="flex items-center gap-1 text-xs text-muted-2">
            차량
            <input
              type="number"
              min={0}
              max={30}
              value={busDraft}
              onChange={(e) => setBusDraft(e.target.value)}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg text-right tabular-nums"
            />
            대
          </label>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              onPatch(trip.id, {
                label,
                departsAt: departsAt ? new Date(departsAt).toISOString() : null,
              });
              const next = Math.max(0, Math.min(30, Number(busDraft) || 0));
              if (next !== busCount) onBusCount(trip.id, next);
              setEditing(false);
            }}
          >
            저장
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
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
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
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
              onClick={() => {
                if (
                  confirm(
                    `"${trip.label}" 운행편을 지웁니다.\n차량이나 신청이 물려 있으면 거부됩니다.`
                  )
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

// ── 차량 ───────────────────────────────────────────────────────

function BusSection({
  buses,
  trips,
  loads,
  upRequests,
  downRequests,
  pending,
  tripLabel,
  onCreate,
  onPatch,
  onDelete,
}: {
  buses: BusRow[];
  trips: TripRow[];
  loads: Record<number, BusLoad>;
  upRequests: Record<number, number[]>;
  downRequests: Record<number, number[]>;
  pending: boolean;
  tripLabel: (id: number | null) => string;
  onCreate: (input: Parameters<typeof createBus>[0]) => void;
  onPatch: (id: number, patch: Parameters<typeof updateBus>[1]) => void;
  onDelete: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const upTrips = trips.filter((t) => t.direction === "up");
  const downTrips = trips.filter((t) => t.direction === "down");
  // 신규 차량의 기본 배정은 **활성** 편에만 건다. 비활성 편에 붙이면
  // /admin/buses 가 활성 편으로만 그룹을 만들어(buses-panel) 그 차량과 승객이
  // 화면에서 통째로 사라진다.
  const activeUp = upTrips.filter((t) => t.active);
  const activeDown = downTrips.filter((t) => t.active);
  const canAddBus = activeUp.length > 0 || activeDown.length > 0;
  const sorted = [...buses].sort(
    (a, b) => a.display_order - b.display_order || a.id - b.id
  );

  return (
    <Card
      title="차량"
      subtitle="대수·정원·운행편·배차 특례를 정합니다. 배정된 인원이 있는 차량은 지울 수 없습니다."
    >
      <div className="px-5 py-4 flex flex-col gap-2">
        <div className="hidden md:grid grid-cols-[1fr_5rem_5rem_1fr_1fr_auto] gap-2 text-xs text-muted-2 px-3">
          <span>호차</span>
          <span>정원</span>
          <span>보조석</span>
          <span>상행 편</span>
          <span>하행 편</span>
          <span />
        </div>

        {sorted.map((b) => (
          <BusRowItem
            key={b.id}
            bus={b}
            load={loads[b.id] ?? { up: 0, down: 0 }}
            upRequested={upRequests[b.id] ?? []}
            downRequested={downRequests[b.id] ?? []}
            upTrips={upTrips}
            downTrips={downTrips}
            pending={pending}
            tripLabel={tripLabel}
            onPatch={onPatch}
            onDelete={onDelete}
          />
        ))}

        <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-border">
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            새 호차 이름
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 12호차"
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg w-40"
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !name.trim() || !canAddBus}
            title={canAddBus ? undefined : "먼저 운행편을 만드세요"}
            onClick={() => {
              onCreate({
                name,
                upTripId: activeUp[0]?.id ?? null,
                downTripId: activeDown[0]?.id ?? null,
              });
              setName("");
            }}
          >
            추가
          </Button>
          <span className="text-xs text-muted-2 self-center">
            {canAddBus
              ? "정원 44 / 보조석 45 로 만들어지고, 첫 활성 운행편에 배정됩니다. 이후 수정하세요."
              : "활성 운행편이 없습니다 — 먼저 운행편을 만드세요."}
          </span>
        </div>
      </div>
    </Card>
  );
}

function BusRowItem({
  bus,
  load,
  upRequested,
  downRequested,
  upTrips,
  downTrips,
  pending,
  tripLabel,
  onPatch,
  onDelete,
}: {
  bus: BusRow;
  load: BusLoad;
  /** 이 차에 배정된 사람들이 신청한 상행 편 id 들. */
  upRequested: number[];
  /** 하행도 같다. */
  downRequested: number[];
  upTrips: TripRow[];
  downTrips: TripRow[];
  pending: boolean;
  tripLabel: (id: number | null) => string;
  onPatch: (id: number, patch: Parameters<typeof updateBus>[1]) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: bus.name,
    capacity: String(bus.capacity),
    hardCap: String(bus.hard_cap),
    upTripId: bus.up_trip_id === null ? "" : String(bus.up_trip_id),
    downTripId: bus.down_trip_id === null ? "" : String(bus.down_trip_id),
    isCohesionExempt: bus.is_cohesion_exempt,
    fillPriority: String(bus.fill_priority),
  });

  const occupied = load.up + load.down;

  // DB 가드 guard_bus_trip_change 와 **같은 술어**:
  //   "바꾼 뒤 신청 편과 어긋나는 배정이 생기는가"
  // 배정된 사람들이 신청한 편이 {X} 하나뿐이면 X 로만 옮길 수 있고,
  // 아무도 안 탔으면 전부 열려 있다. (여러 편이 섞여 있으면 이미 어긋난 상태 → 전부 잠금)
  const lockedOf = (
    occupied: number,
    requested: number[],
    trips: TripRow[]
  ): number[] =>
    occupied === 0
      ? []
      : trips
          .map((t) => t.id)
          .filter((id) => !(requested.length === 1 && requested[0] === id));

  const lockedUpTrips = lockedOf(load.up, upRequested, upTrips);
  // 하행도 3-C 이후 같은 규칙이다. 잠그지 않으면 화면에서는 고를 수 있는데
  // 저장 때 DB 가드가 거절해 "왜 안 되지"가 된다.
  const lockedDownTrips = lockedOf(load.down, downRequested, downTrips);

  if (!editing) {
    return (
      <div className="grid md:grid-cols-[1fr_5rem_5rem_1fr_1fr_auto] gap-2 items-center rounded-lg border border-border px-3 py-2 text-sm">
        <span className="font-medium flex items-center gap-1.5">
          {bus.name}
          {bus.is_cohesion_exempt && <Badge variant="warning">응집 면제</Badge>}
          {bus.fill_priority > 0 && <Badge variant="mute">후순위</Badge>}
        </span>
        <span className="text-muted-2">{bus.capacity}석</span>
        <span className="text-muted-2">{bus.hard_cap}석</span>
        <span className="text-muted-2 truncate">{tripLabel(bus.up_trip_id)}</span>
        <span className="text-muted-2 truncate">{tripLabel(bus.down_trip_id)}</span>
        <span className="flex gap-1 justify-end">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            수정
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending || occupied > 0}
            title={
              occupied > 0
                ? `배정된 인원이 있어 지울 수 없습니다 (상행 ${load.up} / 하행 ${load.down})`
                : undefined
            }
            onClick={() => {
              if (confirm(`"${bus.name}" 차량을 지웁니다.`)) onDelete(bus.id);
            }}
          >
            삭제
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary-300 bg-surface-2 px-3 py-3 flex flex-col gap-2">
      <div className="grid md:grid-cols-[1fr_5rem_5rem_1fr_1fr] gap-2">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
        />
        <input
          type="number"
          value={draft.capacity}
          onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
        />
        <input
          type="number"
          value={draft.hardCap}
          onChange={(e) => setDraft({ ...draft, hardCap: e.target.value })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
        />
        {/*
          잠금 조건은 DB 가드(guard_bus_trip_change)와 **정확히 같아야** 한다.
          화면이 더 엄격하면 "고칠 방법이 화면에 없는" 막다른 길이 되고,
          더 느슨하면 저장 눌렀을 때 서버가 거부해 "왜 안 되지"가 된다.

          가드는 방향마다 "바꾼 뒤 신청 편과 어긋나는 인원"을 센다 → 그 편을 신청한
          사람만 그 편으로 옮길 수 있다. 그래서 선택지별로 판정한다.
          3-C 로 하행도 신청 편을 갖게 되면서 두 방향이 같은 규칙이 됐다.
        */}
        <TripSelect
          value={draft.upTripId}
          trips={upTrips}
          lockedValues={lockedUpTrips}
          lockedHint="이 편으로 옮기면 신청 편과 어긋납니다 — 먼저 재배차하세요"
          onChange={(v) => setDraft({ ...draft, upTripId: v })}
        />
        <TripSelect
          value={draft.downTripId}
          trips={downTrips}
          lockedValues={lockedDownTrips}
          lockedHint="이 편으로 옮기면 신청 편과 어긋납니다 — 먼저 재배차하세요"
          onChange={(v) => setDraft({ ...draft, downTripId: v })}
        />
      </div>

      {load.down > 0 && draft.downTripId !== String(bus.down_trip_id ?? "") && (
        <p className="text-xs text-warning-700">
          하행 {load.down}명이 이 차에 배정돼 있습니다. 편을 바꾸면 배차를 다시 돌려야
          자리가 맞습니다.
        </p>
      )}
      {load.up > 0 && draft.upTripId !== String(bus.up_trip_id ?? "") && (
        <p className="text-xs text-warning-700">
          상행 {load.up}명이 이 차에 배정돼 있습니다. 편을 바꾸면 배차를 다시 돌려야
          자리가 맞습니다.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.isCohesionExempt}
            onChange={(e) =>
              setDraft({ ...draft, isCohesionExempt: e.target.checked })
            }
          />
          응집 면제 (여러 캠퍼스가 섞이는 차)
        </label>
        <label className="flex items-center gap-1.5">
          채움 후순위
          <input
            type="number"
            min={0}
            value={draft.fillPriority}
            onChange={(e) => setDraft({ ...draft, fillPriority: e.target.value })}
            className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-fg"
          />
          <span className="text-muted-2">클수록 나중에 채웁니다 (짐차는 1)</span>
        </label>
      </div>

      <div className="flex gap-1">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            onPatch(bus.id, {
              name: draft.name,
              capacity: Number(draft.capacity),
              hardCap: Number(draft.hardCap),
              upTripId: draft.upTripId === "" ? null : Number(draft.upTripId),
              downTripId: draft.downTripId === "" ? null : Number(draft.downTripId),
              isCohesionExempt: draft.isCohesionExempt,
              fillPriority: Number(draft.fillPriority),
            });
            setEditing(false);
          }}
        >
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          취소
        </Button>
      </div>
    </div>
  );
}

function TripSelect({
  value,
  trips,
  onChange,
  lockedValues = [],
  lockedHint,
}: {
  value: string;
  trips: TripRow[];
  onChange: (v: string) => void;
  /** 고르면 DB 가 거부할 편들 — 통째로 잠그지 않고 그 선택지만 잠근다. */
  lockedValues?: number[];
  lockedHint?: string;
}) {
  const locked = new Set(lockedValues);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
    >
      <option value="">운행 안 함</option>
      {trips.map((t) => (
        <option
          key={t.id}
          value={t.id}
          disabled={locked.has(t.id) && String(t.id) !== value}
          title={locked.has(t.id) ? lockedHint : undefined}
        >
          {t.label}
          {t.active ? "" : " (비활성)"}
          {locked.has(t.id) && String(t.id) !== value ? " — 재배차 필요" : ""}
        </option>
      ))}
    </select>
  );
}

// ── 시각 표기 (항상 KST) ───────────────────────────────────────

function formatKst(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** datetime-local 입력이 쓰는 로컬 형식(YYYY-MM-DDTHH:mm)으로. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
