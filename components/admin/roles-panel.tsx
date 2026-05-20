"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  type RoleLabelRow,
  createRoleLabel,
  updateRoleLabel,
  deleteRoleLabel,
} from "@/lib/admin/role-labels";

const COLORS: { key: string; hex: string; name: string }[] = [
  { key: "green", hex: "#047857", name: "초록" },
  { key: "yellow", hex: "#b45309", name: "노랑" },
  { key: "blue", hex: "#1f3a5f", name: "파랑" },
  { key: "red", hex: "#b91c1c", name: "빨강" },
  { key: "purple", hex: "#6d28d9", name: "보라" },
  { key: "gray", hex: "#57534e", name: "회색" },
];

function hexOf(color: string | null): string {
  return COLORS.find((c) => c.key === color)?.hex ?? color ?? "#57534e";
}

function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block w-3.5 h-3.5 rounded-full ring-1 ring-inset ring-border-2 align-middle"
      style={{ background: hexOf(color) }}
    />
  );
}

export function RolesPanel({ initial }: { initial: RoleLabelRow[] }) {
  const [labels, setLabels] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const [draft, setDraft] = useState({ label: "", color: "green", order: "" });

  function replace(row: RoleLabelRow) {
    setLabels((ls) =>
      ls
        .map((l) => (l.id === row.id ? row : l))
        .sort((a, b) => a.display_order - b.display_order)
    );
  }

  async function handleAdd() {
    const label = draft.label.trim();
    if (!label) return setMsg({ type: "err", text: "라벨 이름을 입력하세요" });
    const order = Number(draft.order) || (labels.length + 1) * 10;
    setBusy(true);
    const res = await createRoleLabel(label, draft.color, order);
    setBusy(false);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    setLabels((ls) =>
      [...ls, res.row].sort((a, b) => a.display_order - b.display_order)
    );
    setDraft({ label: "", color: "green", order: "" });
    setMsg({ type: "ok", text: `'${label}' 추가됨` });
  }

  async function handleUpdate(
    row: RoleLabelRow,
    fields: Partial<Pick<RoleLabelRow, "label" | "color" | "display_order">>
  ) {
    setBusy(true);
    const res = await updateRoleLabel(row.id, fields);
    setBusy(false);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
  }

  async function handleDelete(row: RoleLabelRow) {
    if (
      !confirm(
        `'${row.label}' 라벨을 삭제할까요? 순장/순원들의 역할 목록에서도 함께 제거됩니다.`
      )
    )
      return;
    setBusy(true);
    const res = await deleteRoleLabel(row.id);
    setBusy(false);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    setLabels((ls) => ls.filter((l) => l.id !== row.id));
    setMsg({ type: "ok", text: `'${row.label}' 삭제됨` });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {msg && (
        <div
          className={
            "text-sm rounded-lg px-3 py-2 border " +
            (msg.type === "err"
              ? "bg-danger-bg border-danger-border text-danger"
              : "bg-success-bg border-success-border text-success")
          }
        >
          {msg.text}
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">라벨</th>
                <th className="px-4 py-2.5">색</th>
                <th className="px-4 py-2.5 w-24">순서</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {labels.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted-2 py-6">
                    역할 라벨이 없습니다. 아래에서 추가하세요.
                  </td>
                </tr>
              )}
              {labels.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <input
                      defaultValue={l.label}
                      disabled={busy}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== l.label) handleUpdate(l, { label: v });
                      }}
                      className="border border-border-2 rounded-md px-2 py-1 bg-surface w-40"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <Swatch color={l.color} />
                      <select
                        value={l.color ?? "gray"}
                        disabled={busy}
                        onChange={(e) => handleUpdate(l, { color: e.target.value })}
                        className="border border-border-2 rounded-md px-1.5 py-1 bg-surface text-xs"
                      >
                        {COLORS.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      defaultValue={l.display_order}
                      disabled={busy}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== l.display_order)
                          handleUpdate(l, { display_order: v });
                      }}
                      className="border border-border-2 rounded-md px-2 py-1 bg-surface w-20 tabular-nums"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleDelete(l)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 추가 */}
      <Card title="라벨 추가">
        <div className="p-5 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-muted mb-1">라벨 이름</span>
            <input
              value={draft.label}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="예: 채플담당"
              className="border border-border-2 rounded-md px-2 py-1.5 bg-surface w-40"
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted mb-1">색</span>
            <select
              value={draft.color}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              className="border border-border-2 rounded-md px-2 py-1.5 bg-surface"
            >
              {COLORS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-muted mb-1">순서</span>
            <input
              type="number"
              value={draft.order}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, order: e.target.value }))}
              placeholder="자동"
              className="border border-border-2 rounded-md px-2 py-1.5 bg-surface w-20 tabular-nums"
            />
          </label>
          <Button disabled={busy} onClick={handleAdd}>
            추가
          </Button>
        </div>
      </Card>
    </div>
  );
}
