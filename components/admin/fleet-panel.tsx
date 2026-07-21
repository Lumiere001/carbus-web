"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createTrip,
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
};

const DIRECTION_LABEL: Record<TripDirection, string> = {
  up: "상행 (가는 편)",
  down: "하행 (오는 편)",
};

export function FleetPanel({ trips, buses, loads }: Props) {
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
          onCreate={(label, departsAt) =>
            run(() => createTrip({ direction: dir, label, departsAt }))
          }
          onPatch={(id, patch) => run(() => updateTrip(id, patch))}
          onDelete={(id) => run(() => deleteTrip(id))}
        />
      ))}

      <BusSection
        buses={buses}
        trips={trips}
        loads={loads}
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
  onDelete,
}: {
  direction: TripDirection;
  trips: TripRow[];
  buses: BusRow[];
  pending: boolean;
  onCreate: (label: string, departsAt: string | null) => void;
  onPatch: (id: number, patch: Parameters<typeof updateTrip>[1]) => void;
  onDelete: (id: number) => void;
}) {
  const [label, setLabel] = useState("");
  const [departsAt, setDepartsAt] = useState("");

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
              onCreate(label, departsAt ? new Date(departsAt).toISOString() : null);
              setLabel("");
              setDepartsAt("");
            }}
          >
            추가
          </Button>
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
  onDelete,
}: {
  trip: TripRow;
  busCount: number;
  pending: boolean;
  onPatch: (id: number, patch: Parameters<typeof updateTrip>[1]) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(trip.label);
  const [departsAt, setDepartsAt] = useState(
    trip.departs_at ? toLocalInput(trip.departs_at) : ""
  );

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
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              onPatch(trip.id, {
                label,
                departsAt: departsAt ? new Date(departsAt).toISOString() : null,
              });
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
          <span className="text-xs text-muted-2">
            {trip.departs_at ? formatKst(trip.departs_at) : "출발 시각 미정"}
          </span>
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
  pending,
  tripLabel,
  onCreate,
  onPatch,
  onDelete,
}: {
  buses: BusRow[];
  trips: TripRow[];
  loads: Record<number, BusLoad>;
  pending: boolean;
  tripLabel: (id: number | null) => string;
  onCreate: (input: Parameters<typeof createBus>[0]) => void;
  onPatch: (id: number, patch: Parameters<typeof updateBus>[1]) => void;
  onDelete: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const upTrips = trips.filter((t) => t.direction === "up");
  const downTrips = trips.filter((t) => t.direction === "down");
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
            disabled={pending || !name.trim()}
            onClick={() => {
              onCreate({
                name,
                upTripId: upTrips[0]?.id ?? null,
                downTripId: downTrips[0]?.id ?? null,
              });
              setName("");
            }}
          >
            추가
          </Button>
          <span className="text-xs text-muted-2 self-center">
            정원 44 / 보조석 45 로 만들어지고, 첫 운행편에 배정됩니다. 이후 수정하세요.
          </span>
        </div>
      </div>
    </Card>
  );
}

function BusRowItem({
  bus,
  load,
  upTrips,
  downTrips,
  pending,
  tripLabel,
  onPatch,
  onDelete,
}: {
  bus: BusRow;
  load: BusLoad;
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
        <TripSelect
          value={draft.upTripId}
          trips={upTrips}
          // 배정된 사람이 있으면 편을 못 바꾼다 — DB 트리거와 같은 규칙이다.
          // 화면만 열어두면 저장 눌렀을 때 서버가 거부해 "왜 안 되지"가 된다.
          disabled={load.up > 0}
          disabledHint={`상행 ${load.up}명 배정됨 — 먼저 재배차`}
          onChange={(v) => setDraft({ ...draft, upTripId: v })}
        />
        <TripSelect
          value={draft.downTripId}
          trips={downTrips}
          disabled={load.down > 0}
          disabledHint={`하행 ${load.down}명 배정됨 — 먼저 재배차`}
          onChange={(v) => setDraft({ ...draft, downTripId: v })}
        />
      </div>

      {(load.up > 0 || load.down > 0) && (
        <p className="text-xs text-muted-2">
          배정된 인원이 있어 운행편은 바꿀 수 없습니다. 신청한 편과 어긋나기 때문입니다 —
          배차를 다시 돌린 뒤에 바꾸세요. (이름·정원·특례는 지금 바꿀 수 있습니다)
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
  disabled = false,
  disabledHint,
}: {
  value: string;
  trips: TripRow[];
  onChange: (v: string) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <option value="">운행 안 함</option>
      {trips.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
          {t.active ? "" : " (비활성)"}
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
