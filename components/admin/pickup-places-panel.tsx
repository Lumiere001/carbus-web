"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";
import {
  addPickupPlace,
  updatePickupPlace,
  deletePickupPlace,
  type PlaceRow,
} from "@/lib/admin/pickup";

/**
 * 픽업 장소 관리 (총단 전용).
 *
 * **차를 보내는 건 총단이다.** 그러니 갈 수 있는 곳의 목록도 총단이 정한다.
 * 임역원과 순장/순원은 여기 등록된 것에서 고르기만 한다 — 자유 입력이면
 * 차가 실제로 가지 않는 곳이 적히고, 표기도 사람마다 갈린다.
 *
 * 편성 화면에 있는 이유: 운행편·차량과 마찬가지로 **행사마다 새로 정하는 것**이다.
 * 다음 행사에서는 다른 곳이 된다.
 */
export function PickupPlacesPanel({ places }: { places: PlaceRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", note: "" });

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setErr(res.message ?? "저장하지 못했습니다");
      after?.();
      router.refresh();
    });
  }

  const inputCls =
    "text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface disabled:opacity-60";

  return (
    <Card
      title="픽업 장소"
      subtitle="따로 데리러 갈 곳. 임역원·순장/순원은 여기 등록된 것에서 고르기만 합니다"
    >
      <div className="p-5 space-y-3">
        {err && (
          <p className="text-sm text-danger">{err}</p>
        )}

        <p className="text-xs text-muted-2 leading-snug">
          <b className="text-foreground">안 씀으로</b> 내리면 <b>새로 고를 때만</b>
          목록에서 빠집니다 — 이미 그 장소로 잡힌 수송 요청은 그대로 남습니다.
        </p>

        {places.length === 0 ? (
          <p className="text-sm text-muted-2">
            아직 등록된 픽업 장소가 없습니다. 등록하기 전에는 수송 요청에서
            <b> 장소를 고를 수 없습니다.</b>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {places.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm text-foreground">{p.name}</span>
                  {!p.active && (
                    <Badge variant="mute" dot={false} className="ml-2">
                      안 씀
                    </Badge>
                  )}
                  {p.note && (
                    <span className="block text-xs text-muted-2">{p.note}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* 지우는 대신 내리는 쪽을 기본으로 둔다. 이미 그 장소로 잡힌
                      요청이 있으면 지울 수 없고, 지우면 "어디로 가기로 했었는지"가
                      기록에서 사라진다. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => updatePickupPlace(p.id, { active: !p.active }))
                    }
                    title={
                      p.active
                        ? "새 수송 요청에서만 감춥니다. 이미 이 장소로 잡힌 요청은 그대로 남습니다."
                        : "다시 고를 수 있게 됩니다."
                    }
                    className="text-xs text-muted hover:text-foreground whitespace-nowrap"
                  >
                    {p.active ? "안 씀으로" : "다시 쓰기"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`‘${p.name}’ 을 지울까요?\n이 장소로 잡힌 수송 요청이 있으면 지워지지 않습니다.`))
                        return;
                      run(() => deletePickupPlace(p.id));
                    }}
                    aria-label="픽업 장소 삭제"
                    className="text-muted-2 hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2 pt-1">
          <label className="text-xs text-muted space-y-1 block">
            장소 이름
            <input
              className={inputCls + " w-44 block"}
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="예: ○○역"
            />
          </label>
          <label className="text-xs text-muted space-y-1 block flex-1 min-w-[12rem]">
            안내 (선택)
            <input
              className={inputCls + " w-full block"}
              value={draft.note}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              placeholder="예: 1번 출구 앞 버스정류장"
            />
          </label>
          <Button
            size="sm"
            disabled={busy || !draft.name.trim()}
            onClick={() =>
              run(
                () => addPickupPlace(draft.name, draft.note || null),
                () => setDraft({ name: "", note: "" })
              )
            }
          >
            <Plus size={14} /> 장소 추가
          </Button>
        </div>
      </div>
    </Card>
  );
}
