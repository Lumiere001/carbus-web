"use client";

import { Badge } from "@/components/ui/badge";
import {
  DIRECTION_LABELS,
  DIRECTION_SHORT,
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
            //
            // 타지구로 바꿀 때는 **확정 대기가 기본**이다. "타지구 차를 얻어 타기로
            // 했다"는 말 자체가 보통 아직 확정 전이고, 확정으로 저장하면 그 자리에서
            // 좌석이 반납돼 되돌리려면 재배차해야 한다. 기본값은 되돌릴 수 있는
            // 쪽이어야 한다 — 확정이 나면 그때 체크를 풀거나 이동수단 화면에서 누른다.
            onChange(
              mode === "other_district"
                ? { ...value, mode, status: "pending" }
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
              // 라벨이 "지구 → 수련회장" 이라 그냥 `${label} 지구` 로 두면
              // "지구 → 수련회장 지구" 가 되어 무엇을 고르는 칸인지 안 읽힌다.
              aria-label={`${label} 타지구 이름`}
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
          확정될 때까지 우리 버스 좌석을 잡아둡니다. 확정으로 바꾸면 이 방향의
          운행편과 배정 호차가 <b>자동으로 비워집니다</b>.
        </p>
      )}
      {isOther && value.status === "confirmed" && (
        <p className="text-xs text-muted-2">
          확정 — 저장하면 이 방향의 우리 버스 자리를 놓습니다. 되돌리려면 편을 다시
          지정하고 배차를 다시 실행해야 합니다.
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
  // 배지는 한 칸에 들어가야 해서 짧은 형태를 쓰되, **긴 문구를 title 로 함께 단다.**
  // 짧은 쪽만 남으면 "가는 편" 이 어디서 어디로인지 다시 헷갈린다.
  const items = (["up", "down"] as const)
    .map((dir) => ({
      dir,
      b: transportBadge(
        dir === "up" ? up.mode : down.mode,
        dir === "up" ? up.status : down.status,
        dir === "up" ? up.via : down.via
      ),
    }))
    .filter((x) => x.b !== null);

  if (items.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map(({ dir, b }) => (
        <Badge
          key={dir}
          variant={b!.tone}
          dot={false}
          title={`${DIRECTION_LABELS[dir]} — ${b!.title}`}
        >
          {items.length > 1 ? `${DIRECTION_SHORT[dir].slice(0, 1)} ` : ""}
          {b!.text}
        </Badge>
      ))}
    </span>
  );
}
