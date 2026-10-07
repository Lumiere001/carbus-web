import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttendanceState } from "@/lib/attendance/state";
import { attendanceProgress } from "./model";
import type { AttendanceBus, AttendanceDirection, AttendanceGroup } from "./model";

const controlClass = "min-h-11 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600";
const selectedClass = "bg-primary-50 text-primary-800 font-medium";
const idleClass = "text-muted hover:bg-surface-2";

type ControlsProps = {
  readonly direction: AttendanceDirection;
  readonly selectedBus: number | null;
  readonly groups: readonly AttendanceGroup[];
  readonly buses: ReadonlyMap<number, AttendanceBus>;
  readonly state: AttendanceState;
  readonly onDirection: (direction: AttendanceDirection) => void;
  readonly onBus: (id: number | null) => void;
};

export function AttendanceControls({ direction, selectedBus, groups, buses, state, onDirection, onBus }: ControlsProps) {
  const busIds = [...new Set(groups.map(([id]) => id))].sort((a, b) => a - b);
  const field = direction === "up" ? "checked_in" : "checked_out";
  return (
    <div className="sticky top-0 z-20 -mx-1 space-y-2 border-b border-border bg-surface/95 px-1 py-2 backdrop-blur">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onDirection("up")}
          aria-pressed={direction === "up"}
          className={cn(controlClass, direction === "up" ? selectedClass : idleClass)}
        >
          <ArrowUp size={13} className="mr-1 inline" aria-hidden="true" />
          {direction === "up" && <Check size={13} className="mr-1 inline" aria-hidden="true" />}
          상행 (올라갈 때)
        </button>
        <button
          type="button"
          onClick={() => onDirection("down")}
          aria-pressed={direction === "down"}
          className={cn(controlClass, direction === "down" ? selectedClass : idleClass)}
        >
          <ArrowDown size={13} className="mr-1 inline" aria-hidden="true" />
          {direction === "down" && <Check size={13} className="mr-1 inline" aria-hidden="true" />}
          하행 (내려올 때)
        </button>
      </div>
      {busIds.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => onBus(null)}
            aria-pressed={selectedBus == null}
            className={cn(controlClass, "shrink-0", selectedBus == null ? selectedClass : idleClass)}
          >
            {selectedBus == null && <Check size={13} className="mr-1 inline" aria-hidden="true" />}
            전체
          </button>
          {busIds.map((id) => {
            const members = groups.filter(([busId]) => busId === id).flatMap(([, group]) => group);
            const { done, total } = attendanceProgress(members, state, field);
            const complete = total > 0 && done === total;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onBus(id)}
                aria-pressed={selectedBus === id}
                className={cn(
                  controlClass,
                  "shrink-0 whitespace-nowrap",
                  selectedBus === id ? selectedClass : complete ? "bg-success-bg text-success" : idleClass
                )}
              >
                {selectedBus === id && <Check size={13} className="mr-1 inline" aria-hidden="true" />}
                {buses.get(id)?.name ?? `${id}호차`}{" "}
                <span className="text-xs tabular-nums">{done}/{total}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
