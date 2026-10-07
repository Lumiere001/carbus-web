import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { formatKst } from "@/lib/time/kst";
import { PICKUP_DIRECTION_LABELS } from "@/lib/transport/labels";
import type { Dispatch, SetStateAction } from "react";
import type { PickupDraft, RegDrawerProps } from "./types";

const inputCls = "w-full text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface disabled:opacity-60";
const labelCls = "text-xs text-muted space-y-1 block";

export function DrawerPickupFields({
  pickups, places, busy, draft, error, setDraft, setError, addPickup, removePickup,
}: Pick<RegDrawerProps, "pickups" | "places"> & {
  readonly busy: boolean;
  readonly draft: PickupDraft;
  readonly error: string;
  readonly setDraft: Dispatch<SetStateAction<PickupDraft>>;
  readonly setError: (error: string) => void;
  readonly addPickup: () => void;
  readonly removePickup: (id: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2.5">
      <p className="text-sm font-semibold text-foreground">
        수송 요청 <span className="text-xs font-normal text-muted">추가 버튼으로 저장</span>
      </p>
      <p className="text-xs text-muted-2 leading-snug">
        따로 데리러 가야 할 때 입력하세요.{" "}
        <span className="whitespace-nowrap">시각·장소는 미정으로 남길 수 있습니다.</span>
      </p>
      {pickups.length > 0 && (
        <ul className="space-y-1">
          {pickups.map((pickup) => (
            <li key={pickup.id} className="flex items-start justify-between gap-2 text-xs bg-surface rounded-md border border-border px-2 py-1.5">
              <span className="min-w-0">
                <b className="text-foreground">{PICKUP_DIRECTION_LABELS[pickup.direction]}</b>{" "}
                <span className={pickup.pickupAt ? "text-muted" : "text-danger"}>
                  {pickup.pickupAt ? formatKst(pickup.pickupAt) : "시각 미정"}
                </span>
                <span className="text-muted-2">{pickup.placeName ? ` · ${pickup.placeName}` : " · 장소 미정"}</span>
                {pickup.note && (
                  <span role="note" aria-label="수송 메모" className="mt-1 block whitespace-pre-wrap break-words text-foreground">
                    <span className="mr-2 text-muted">수송 메모</span>{pickup.note}
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => removePickup(pickup.id)}
                aria-label="수송 요청 삭제"
                title="수송 요청 삭제"
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-danger-bg hover:text-danger shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={labelCls}>
        수송 방향
        <select
          className={inputCls}
          value={draft.direction}
          disabled={busy}
          aria-label="수송 방향"
          onChange={(event) => {
            const direction = event.target.value;
            if (direction === "up" || direction === "down") setDraft((current) => ({ ...current, direction }));
          }}
        >
          <option value="up">{PICKUP_DIRECTION_LABELS.up}</option>
          <option value="down">{PICKUP_DIRECTION_LABELS.down}</option>
        </select>
      </label>
      <DateTimeField
        label="픽업 일시"
        value={draft.at}
        disabled={busy}
        error={error}
        onChange={(value) => { setError(""); setDraft((current) => ({ ...current, at: value })); }}
      />
      <label className={labelCls}>
        픽업 장소
        <select
          className={inputCls}
          value={draft.placeId}
          disabled={busy || places.length === 0}
          onChange={(event) => setDraft((current) => ({ ...current, placeId: event.target.value }))}
          aria-label="픽업 장소"
        >
          <option value="">장소 미정</option>
          {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
        </select>
      </label>
      {places.length === 0 && (
        <p className="text-xs text-warning leading-snug">
          이 행사에 등록된 픽업 장소가 없습니다. 총단 운영자가 <b className="whitespace-nowrap">운행편·차량 편성</b> 화면에서
          먼저 장소를 등록해야 고를 수 있습니다.
        </p>
      )}
      <label className={labelCls}>
        수송 요청 메모 (선택)
        <input
          type="text"
          className={inputCls}
          value={draft.note}
          disabled={busy}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          placeholder="메모 (선택)"
          aria-label="수송 요청 메모"
        />
      </label>
      <Button size="sm" disabled={busy} onClick={addPickup}><Plus size={14} /> 수송 요청 추가</Button>
    </div>
  );
}
