"use client";

import { useMemo, useState } from "react";
import { AttendanceControls } from "@/components/attendance/attendance-controls";
import { AttendanceRoster } from "@/components/attendance/attendance-roster";
import { AttendanceSummary } from "@/components/attendance/attendance-summary";
import { useAttendance } from "@/components/attendance/use-attendance";
import type { AttendanceDirection, BusAttendanceProps } from "@/components/attendance/model";

/** Direction-specific bus checks; only confirmed server revisions display as completed. */
export function BusAttendance({
  campusId, upGroups, downGroups, buses, slots, editable = true, summary,
}: BusAttendanceProps) {
  const busById = useMemo(() => new Map(buses.map((bus) => [bus.id, bus])), [buses]);
  const { state, errors, saving, toggle } = useAttendance(upGroups, downGroups, editable, campusId);
  const [selectedBus, setSelectedBus] = useState<number | null>(null);
  const [direction, setDirection] = useState<AttendanceDirection>("up");
  const groups = direction === "up" ? upGroups : downGroups;
  const selectedGroups = selectedBus == null ? groups : groups.filter(([id]) => id === selectedBus);

  return (
    <div className="space-y-4">
      {summary && (
        <AttendanceSummary
          summary={summary}
          upGroups={upGroups}
          downGroups={downGroups}
          buses={busById}
          state={state}
        />
      )}
      <AttendanceControls
        direction={direction}
        selectedBus={selectedBus}
        groups={groups}
        buses={busById}
        state={state}
        onDirection={(nextDirection) => {
          setDirection(nextDirection);
          setSelectedBus(null);
        }}
        onBus={setSelectedBus}
      />
      <AttendanceRoster
        groups={selectedGroups}
        direction={direction}
        buses={busById}
        slots={slots}
        state={state}
        editable={editable}
        saving={saving}
        errors={errors}
        onToggle={toggle}
      />
      {selectedBus != null &&
        !upGroups.some(([id]) => id === selectedBus) &&
        !downGroups.some(([id]) => id === selectedBus) && (
          <p className="py-6 text-center text-sm text-muted-2">이 호차에 배정된 인원이 없습니다.</p>
        )}
    </div>
  );
}
