"use client";

import { useConfirmation } from "@/components/ui/use-confirmation";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FleetTripSection } from "./fleet-trip-section";
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

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>): Promise<boolean> => new Promise((resolve) => {
    startTransition(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          setMsg(null);
          router.refresh();
        } else {
          setMsg({ kind: "err", text: r.message ?? "저장하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요." });
        }
        resolve(r.ok);
      } catch {
        setMsg({ kind: "err", text: "저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요." });
        resolve(false);
      }
    });
  });

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
          role={msg.kind === "err" ? "alert" : "status"}
          className={
            msg.kind === "err"
              ? "rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger"
              : "rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm"
          }
        >
          {msg.text}
        </div>
      )}

      {(["up", "down"] as const).map((dir) => (
        <FleetTripSection
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
  onCreate: (input: Parameters<typeof createBus>[0]) => Promise<boolean>;
  onPatch: (id: number, patch: Parameters<typeof updateBus>[1]) => Promise<boolean>;
  onDelete: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"bus" | "staff_car">("bus");
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
      title="차량 · 간사 차량"
      subtitle="대수·정원·운행편·배차 특례를 정합니다. 맨 아래에서 버스와 간사 차량을 추가할 수 있습니다. 배정된 탑승자가 있는 차량만 지울 수 없습니다."
    >
      <div className="px-5 py-4 flex flex-col gap-2">
        <div className="hidden md:grid grid-cols-[1fr_5rem_5rem_1fr_1fr_auto] gap-2 text-xs text-muted-2 px-3">
          <span>호차</span>
          <span>정원</span>
          <span>최대 정원</span>
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
              disabled={pending}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 12호차"
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground w-40"
            />
          </label>
          {/* 간사 차량(§26-E)은 여기서 만든다. 이름을 자유 입력으로 둔 것은
              `N호차` 자동 번호와 섞이면 안 되기 때문이다 — "A간사차" 가 번호를
              밀어내면 다음 버스가 엉뚱한 번호를 받는다. */}
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            종류
            <select
              disabled={pending}
              value={kind}
              onChange={(e) => setKind(e.target.value as "bus" | "staff_car")}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
              aria-label="차량 종류"
            >
              <option value="bus">버스</option>
              <option value="staff_car">간사 차량</option>
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !name.trim() || !canAddBus}
            title={canAddBus ? undefined : "먼저 운행편을 만드세요"}
            onClick={async () => {
              const isStaff = kind === "staff_car";
              const saved = await onCreate({
                name,
                kind,
                // 간사 차량은 승용차다. 44석으로 만들어 두면 대시보드의 남은 좌석이
                // 40석 넘게 부풀고, 그 숫자를 보고 버스를 덜 부르게 된다.
                ...(isStaff ? { capacity: 4, hardCap: 4 } : {}),
                upTripId: activeUp[0]?.id ?? null,
                downTripId: activeDown[0]?.id ?? null,
              });
              if (saved) setName("");
            }}
          >
            추가
          </Button>
          <span className="text-xs text-muted-2 self-center">
            {!canAddBus
              ? "활성 운행편이 없습니다 — 먼저 운행편을 만드세요."
              : kind === "staff_car"
                ? "정원 4로 만들어집니다. 간사 차량은 자동 배차에서 빠지고, 탈 사람은 리더 화면에서 고정 탑승자로 지정합니다."
                : "정원 44석 / 보조석 포함 최대 45석으로 만들어지고, 첫 활성 운행편에 배정됩니다. 이후 수정하세요."}
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
  onPatch: (id: number, patch: Parameters<typeof updateBus>[1]) => Promise<boolean>;
  onDelete: (id: number) => void;
}) {
  const { requestConfirmation, confirmationDialog } = useConfirmation();
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
      {confirmationDialog}
        <span className="font-medium flex items-center gap-1.5">
          {bus.name}
          {/* 간사 차량은 규칙이 다르다(자동 배차 제외·수동 지정). 목록에서 버스와
              구분되지 않으면 "왜 이 차만 비어 있지" 가 된다. */}
          {bus.kind === "staff_car" && (
            <Badge
              variant="primary"
              title="간사 차량 — 자동 배차에서 빠집니다. 탈 사람은 리더 화면에서 고정 탑승자로 지정하세요."
            >
              간사 차량
            </Badge>
          )}
          {/* 배지만으로는 "이 차가 왜 다른지" 를 알 수 없었다. 무슨 뜻인지 붙이고,
              눌러서 바로 고칠 수 있게 한다 — 끄는 자리가 수정 폼 안에 있다는 걸
              모르면 영영 못 찾는다. */}
          {bus.is_cohesion_exempt && (
            <button type="button" disabled={pending} onClick={() => setEditing(true)} title="이 차는 캠퍼스를 한 차에 모으는 규칙에서 빠집니다. 눌러서 끄기">
              <Badge variant="warning">캠퍼스 섞임 허용</Badge>
            </button>
          )}
          {bus.fill_priority > 0 && (
            <button type="button" disabled={pending} onClick={() => setEditing(true)} title={`다른 차를 다 채운 뒤 마지막에 채웁니다 (후순위 ${bus.fill_priority}). 눌러서 끄기`}>
              <Badge variant="mute">마지막에 채움</Badge>
            </button>
          )}
        </span>
        <span className="text-muted-2"><span className="md:hidden">정원 · </span>{bus.capacity}석</span>
        <span className="text-muted-2"><span className="md:hidden">보조석 포함 최대 · </span>{bus.hard_cap}석</span>
        <span className="text-muted-2 truncate"><span className="md:hidden">상행 편 · </span>{tripLabel(bus.up_trip_id)}</span>
        <span className="text-muted-2 truncate"><span className="md:hidden">하행 편 · </span>{tripLabel(bus.down_trip_id)}</span>
        <span className="flex gap-1 justify-end">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
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
            onClick={async () => {
              // 무엇이 함께 사라지는지 적는다. 차량순장·고정 탑승자 지정은 이제
              // 삭제를 **막지 않으므로**(탑승자만 막는다), 사라진다는 사실을
              // 여기서 말하지 않으면 아무 데서도 안 나온다.
              const gone: string[] = [];
              if (bus.driver_registration_id) gone.push("상행 차량순장");
              if (bus.down_driver_registration_id) gone.push("하행 차량순장");
              if ((bus.fixed_passenger_ids ?? []).length)
                gone.push(`상행 고정 탑승자 ${bus.fixed_passenger_ids.length}명`);
              if ((bus.down_fixed_passenger_ids ?? []).length)
                gone.push(`하행 고정 탑승자 ${bus.down_fixed_passenger_ids.length}명`);
              const msg = gone.length
                ? `"${bus.name}" 차량과 다음 지정을 함께 지웁니다: ${gone.join(" · ")}.\n\n차량을 다시 만들면 리더 화면에서 새로 지정하세요.`
                : `"${bus.name}" 차량을 지웁니다.`;
              if ((await requestConfirmation({ title: "차량을 삭제할까요?", description: msg, confirmLabel: "차량 삭제", tone: "danger" }))) onDelete(bus.id);
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
      {confirmationDialog}
      <div className="grid md:grid-cols-[1fr_5rem_5rem_1fr_1fr] gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-2">
          차량 이름
        <input
          disabled={pending}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
        />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-2">
          정원
        <input
          disabled={pending}
          type="number"
          value={draft.capacity}
          onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
        />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-2">
          보조석 포함 최대
        <input
          disabled={pending}
          type="number"
          value={draft.hardCap}
          onChange={(e) => setDraft({ ...draft, hardCap: e.target.value })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
        />
        </label>
        {/*
          잠금 조건은 DB 가드(guard_bus_trip_change)와 **정확히 같아야** 한다.
          화면이 더 엄격하면 "고칠 방법이 화면에 없는" 막다른 길이 되고,
          더 느슨하면 저장 눌렀을 때 서버가 거부해 "왜 안 되지"가 된다.

          가드는 방향마다 "바꾼 뒤 신청 편과 어긋나는 인원"을 센다 → 그 편을 신청한
          사람만 그 편으로 옮길 수 있다. 그래서 선택지별로 판정한다.
          3-C 로 하행도 신청 편을 갖게 되면서 두 방향이 같은 규칙이 됐다.
        */}
        <label className="flex flex-col gap-1 text-xs text-muted-2">
          상행 편
        <TripSelect
          disabled={pending}
          value={draft.upTripId}
          trips={upTrips}
          lockedValues={lockedUpTrips}
          lockedHint="이 편으로 옮기면 신청 편과 어긋납니다 — 먼저 재배차하세요"
          onChange={(v) => setDraft({ ...draft, upTripId: v })}
        />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-2">
          하행 편
        <TripSelect
          disabled={pending}
          value={draft.downTripId}
          trips={downTrips}
          lockedValues={lockedDownTrips}
          lockedHint="이 편으로 옮기면 신청 편과 어긋납니다 — 먼저 재배차하세요"
          onChange={(v) => setDraft({ ...draft, downTripId: v })}
        />
        </label>
      </div>

      {load.down > 0 && draft.downTripId !== String(bus.down_trip_id ?? "") && (
        <p className="text-xs text-warning">
          하행 {load.down}명이 이 차에 배정돼 있습니다. 편을 바꾸면 배차를 다시 돌려야
          자리가 맞습니다.
        </p>
      )}
      {load.up > 0 && draft.upTripId !== String(bus.up_trip_id ?? "") && (
        <p className="text-xs text-warning">
          상행 {load.up}명이 이 차에 배정돼 있습니다. 편을 바꾸면 배차를 다시 돌려야
          자리가 맞습니다.
        </p>
      )}

      <div className="rounded-md border border-border bg-surface px-3 py-2.5 flex flex-col gap-2 text-xs">
        <p className="text-muted-2 leading-snug">
          <b className="text-foreground">배차 특례</b> — 이 차만 다르게 채우고 싶을 때만
          켜세요. 둘 다 꺼두면 다른 차들과 똑같이 배차됩니다.
        </p>
        <label className="flex items-start gap-2">
          <input
            disabled={pending}
            type="checkbox"
            className="mt-0.5"
            checked={draft.isCohesionExempt}
            onChange={(e) =>
              setDraft({ ...draft, isCohesionExempt: e.target.checked })
            }
          />
          <span>
            <b className="text-foreground">캠퍼스 섞임 허용</b>
            <span className="block text-muted-2 leading-snug">
              배차는 같은 캠퍼스를 한 차에 모읍니다. 이걸 켜면 그 규칙에서 빠져
              여러 캠퍼스가 섞입니다.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            disabled={pending}
            type="checkbox"
            className="mt-0.5"
            checked={Number(draft.fillPriority) > 0}
            onChange={(e) =>
              setDraft({ ...draft, fillPriority: e.target.checked ? "1" : "0" })
            }
          />
          <span>
            <b className="text-foreground">마지막에 채움</b>
            <span className="block text-muted-2 leading-snug">
              다른 차를 다 채운 뒤에 이 차를 씁니다. 짐이나 여유 좌석용 차에 켭니다.
            </span>
          </span>
        </label>
        {Number(draft.fillPriority) > 1 && (
          <p className="text-muted-2">
            지금 후순위 값이 <b>{draft.fillPriority}</b> 입니다 — 여러 단계로 나눠 둔
            설정이라 체크를 풀면 0 이 됩니다.
          </p>
        )}
      </div>

      <div className="flex gap-1">
        <Button
          size="sm"
          disabled={pending}
          onClick={async () => {
            const saved = await onPatch(bus.id, {
              name: draft.name,
              capacity: Number(draft.capacity),
              hardCap: Number(draft.hardCap),
              upTripId: draft.upTripId === "" ? null : Number(draft.upTripId),
              downTripId: draft.downTripId === "" ? null : Number(draft.downTripId),
              isCohesionExempt: draft.isCohesionExempt,
              fillPriority: Number(draft.fillPriority),
            });
            if (saved) setEditing(false);
          }}
        >
          저장
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
          취소
        </Button>
      </div>
    </div>
  );
}

function TripSelect({
  disabled,
  value,
  trips,
  onChange,
  lockedValues = [],
  lockedHint,
}: {
  disabled: boolean;
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
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
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
