import { AutosaveTextField } from "@/components/admin/autosave-text-field";
import { PAYMENT_LABELS, PAYMENT_STATUSES } from "@/lib/labels";
import type { RegDrawerProps, SaveRegField } from "./types";

const inputCls = "w-full text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface disabled:opacity-60";
const labelCls = "text-xs text-muted space-y-1 block";

export function DrawerBasicFields({
  row, campuses, variant, busy, save, onNameDirty, onStudentDirty, onNoteDirty,
}: Pick<RegDrawerProps, "row" | "campuses" | "variant"> & {
  readonly busy: boolean;
  readonly save: SaveRegField;
  readonly onNameDirty: (dirty: boolean) => void;
  readonly onStudentDirty: (dirty: boolean) => void;
  readonly onNoteDirty: (dirty: boolean) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-border p-3 space-y-3">
      <legend className="px-1 text-sm font-semibold text-foreground">기본 정보 · 자동 저장</legend>
      <p className="text-xs text-muted">선택은 바로 저장, 글자는 칸을 벗어나면 저장됩니다.</p>
      <AutosaveTextField
        key={`name:${row.name}`}
        label="이름"
        value={row.name}
        disabled={busy}
        onDirtyChange={onNameDirty}
        onSave={(value) => save("이름", { name: row.name }, { name: value })}
      />
      <div className="grid grid-cols-2 gap-2">
        <AutosaveTextField
          key={`student:${row.student_id}`}
          label="학번"
          value={row.student_id}
          disabled={busy}
          onDirtyChange={onStudentDirty}
          onSave={(value) => save("학번", { student_id: row.student_id }, { student_id: value })}
        />
        <label className={labelCls}>
          캠퍼스
          <select
            className={inputCls}
            value={row.campus_id}
            disabled={busy || variant === "campus"}
            onChange={(event) => save("캠퍼스", { campus_id: row.campus_id }, { campus_id: event.target.value })}
          >
            {campuses.map((campus) => (
              <option key={campus.id} value={campus.id}>{campus.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={labelCls}>
        납부
        <select
          className={inputCls}
          value={row.payment_status}
          disabled={busy}
          onChange={(event) => {
            const status = PAYMENT_STATUSES.find((value) => value === event.target.value);
            if (status) save("납부", { payment_status: row.payment_status }, { payment_status: status });
          }}
        >
          {PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>{PAYMENT_LABELS[status]}</option>
          ))}
        </select>
      </label>
      <AutosaveTextField
        key={`note:${row.note}`}
        label="비고 (특이사항 등 자유 기록)"
        value={row.note ?? ""}
        disabled={busy}
        multiline
        onDirtyChange={onNoteDirty}
        onSave={(value) => save("비고", { note: row.note }, { note: value || null })}
      />
    </fieldset>
  );
}
