import { ArrowDown, ArrowUp, Bus, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { slotLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { AttendanceState } from "@/lib/attendance/state";
import { attendanceProgress } from "./model";
import type {
  AttendanceBus,
  AttendanceDirection,
  AttendanceField,
  AttendanceGroup,
  AttendanceMember,
  AttendanceSlot,
} from "./model";

type RosterProps = {
  readonly groups: readonly AttendanceGroup[];
  readonly direction: AttendanceDirection;
  readonly buses: ReadonlyMap<number, AttendanceBus>;
  readonly slots: readonly AttendanceSlot[];
  readonly state: AttendanceState;
  readonly editable: boolean;
  readonly saving: Readonly<Record<string, boolean>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly onToggle: (id: string, field: AttendanceField) => void;
};

type MemberRowProps = {
  readonly member: AttendanceMember;
  readonly field: AttendanceField;
} & Pick<RosterProps, "state" | "editable" | "saving" | "errors" | "onToggle">;

function AttendanceMemberRow({ member, field, state, editable, saving, errors, onToggle }: MemberRowProps) {
  const on = state[member.id]?.[field] ?? member[field];
  const key = `${member.id}:${field}`;
  const content = (
    <>
      <span className="flex min-w-0 flex-1 items-start gap-2.5">
        {on ? (
          <Check size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <span className="mt-0.5 inline-block h-[18px] w-[18px] shrink-0 rounded-full border-2 border-border-2" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className={cn(
            "text-base [overflow-wrap:anywhere]",
            on ? "font-medium text-success" : "text-foreground"
          )}>
            {member.name}
          </span>
          {member.campus && (
            <span className="text-xs font-normal text-muted-2 [overflow-wrap:anywhere]">
              {member.campus}
            </span>
          )}
        </span>
      </span>
      <span className="text-xs text-muted-2 [overflow-wrap:anywhere]">{member.student_id}</span>
      {saving[key] && <span role="status" className="shrink-0 text-xs text-muted">저장 중…</span>}
    </>
  );
  const rowClass = cn(
    "flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2.5 text-left select-none",
    on && "bg-success-bg"
  );
  return (
    <li className="min-w-0 border-b border-border bg-surface">
      {editable ? (
        <button
          type="button"
          onClick={() => onToggle(member.id, field)}
          disabled={saving[key]}
          aria-busy={saving[key] || undefined}
          aria-pressed={on}
          className={cn(
            rowClass,
            "transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600",
            !on && "hover:bg-surface-2/60"
          )}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      {errors[key] && (
        <p role="alert" className="mx-4 mb-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger [overflow-wrap:anywhere]">
          {errors[key]}
        </p>
      )}
    </li>
  );
}

export function AttendanceRoster(props: RosterProps) {
  const { groups, direction, buses, slots, state, editable } = props;
  if (groups.length === 0) return null;
  const field = direction === "up" ? "checked_in" : "checked_out";
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  const title = direction === "up" ? "상행 명단 (올라갈 때)" : "하행 명단 (내려올 때)";
  const checkLabel = direction === "up" ? "출발 버스" : "귀가";
  return (
    <section className="space-y-3">
      <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-muted">
        <Icon size={15} className="text-primary-700" aria-hidden="true" />{title}
        <span className="text-xs font-normal text-muted-2">
          {editable ? `— 이름을 탭하면 ${checkLabel} 체크` : `— ${checkLabel} 현황`}
        </span>
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(30rem,100%),1fr))] items-start gap-4">
        {groups.map(([busId, members]) => {
          const info = buses.get(busId);
          const { done, total } = attendanceProgress(members, state, field);
          return (
            <Card key={busId} className="min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-foreground">
                  <Bus size={18} className="shrink-0 text-primary-700" aria-hidden="true" />
                  <span className="[overflow-wrap:anywhere]">{info?.name ?? `${busId}호차`}</span>
                  <span className="text-xs font-normal text-muted-2 [overflow-wrap:anywhere]">
                    {direction === "up" && info && `${slotLabel(info.up_trip_id, [...slots])} 출발`}
                    {direction === "down" && "하행 (내려올 때)"}
                  </span>
                </span>
                <Badge variant={done === total ? "success" : "primary"} dot={false}>
                  {checkLabel} {done}/{total}
                </Badge>
              </div>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(14rem,100%),1fr))] gap-x-3 bg-surface">
                {members.map((member) => (
                  <AttendanceMemberRow
                    key={member.id}
                    member={member}
                    field={field}
                    state={state}
                    editable={editable}
                    saving={props.saving}
                    errors={props.errors}
                    onToggle={props.onToggle}
                  />
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
