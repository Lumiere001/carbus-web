"use client";

import { Badge } from "@/components/ui/badge";
import {
  TRANSPORT_LABELS,
  TRANSPORT_MODES,
  transportBadge,
  type TransportMode,
  type TransportStatus,
} from "@/lib/transport/labels";

export type LegValue = {
  mode: TransportMode;
  viaUnitId: string | null;
  status: TransportStatus;
};

export const DEFAULT_LEG: LegValue = {
  mode: "our_bus",
  viaUnitId: null,
  status: "confirmed",
};

/**
 * 한 방향의 이동수단 입력 (3단계).
 *
 * 화면이 DB 제약과 **같은 규칙**을 먼저 적용한다 — 타지구가 아니면 지구 칸과
 * 확정 대기 칸을 아예 안 보여준다. 안 그러면 고를 수 있는데 저장이 거부되는
 * 상태가 되고, 이 레포에서 그 유형의 결함이 이미 네 번 나왔다.
 */
export function TransportPicker({
  label,
  value,
  units,
  disabled,
  onChange,
}: {
  label: string;
  value: LegValue;
  units: { id: string; name: string }[];
  disabled?: boolean;
  onChange: (v: LegValue) => void;
}) {
  const isOther = value.mode === "other_district";
  const sel =
    "text-sm border border-border-2 rounded-md px-2 py-1.5 bg-surface text-fg";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-2">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={value.mode}
          disabled={disabled}
          onChange={(e) => {
            const mode = e.target.value as TransportMode;
            // 타지구가 아니게 되면 지구·대기 상태를 같이 지운다 (DB 제약과 동일).
            onChange(
              mode === "other_district"
                ? { ...value, mode }
                : { mode, viaUnitId: null, status: "confirmed" }
            );
          }}
          className={sel}
          aria-label={`${label} 이동수단`}
        >
          {TRANSPORT_MODES.map((m) => (
            <option key={m} value={m}>
              {TRANSPORT_LABELS[m]}
            </option>
          ))}
        </select>

        {isOther && (
          <>
            <select
              value={value.viaUnitId ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...value, viaUnitId: e.target.value || null })
              }
              className={sel}
              aria-label={`${label} 지구`}
            >
              <option value="">지구 선택…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={value.status === "pending"}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    status: e.target.checked ? "pending" : "confirmed",
                  })
                }
              />
              확정 대기
            </label>
          </>
        )}
      </div>
      {isOther && value.status === "pending" && (
        <p className="text-xs text-warning-700">
          확정될 때까지 우리 버스 좌석을 잡아둡니다. 타지구가 확정되면 이 방향의
          운행편을 비워 주세요 — 그래야 자리가 반납됩니다.
        </p>
      )}
    </div>
  );
}

/** 표에 쓰는 읽기 전용 배지 (상·하행 묶음). */
export function TransportBadges({
  up,
  down,
}: {
  up: { mode: TransportMode | null; status: TransportStatus | null; via: string | null };
  down: { mode: TransportMode | null; status: TransportStatus | null; via: string | null };
}) {
  const items = [
    { dir: "갈 때", b: transportBadge(up.mode, up.status, up.via) },
    { dir: "올 때", b: transportBadge(down.mode, down.status, down.via) },
  ].filter((x) => x.b !== null);

  if (items.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map(({ dir, b }) => (
        <Badge key={dir} variant={b!.tone} dot={false} title={`${dir} — ${b!.title}`}>
          {items.length > 1 ? `${dir.slice(0, 1)} ` : ""}
          {b!.text}
        </Badge>
      ))}
    </span>
  );
}
