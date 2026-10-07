import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { attendanceSnapshotSchema, mergeAttendance } from "@/lib/attendance/state";
import type { AttendanceField, AttendanceGroup } from "./model";

export function useAttendance(
  upGroups: readonly AttendanceGroup[],
  downGroups: readonly AttendanceGroup[],
  editable: boolean,
  campusId?: string
) {
  const membersById = useMemo(
    () => new Map([...upGroups, ...downGroups].flatMap(([, members]) => members.map((member) => [member.id, member] as const))),
    [upGroups, downGroups]
  );
  const [checks, setChecks] = useState(() => ({
    source: membersById,
    values: mergeAttendance({}, [...membersById.values()]),
  }));
  if (checks.source !== membersById) {
    setChecks({ source: membersById, values: mergeAttendance(checks.values, [...membersById.values()]) });
  }
  const state = checks.values;
  const requests = useRef(new Set<string>());
  const unreadSaved = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const supabase = createClient();
    const sub: { event: "UPDATE"; schema: string; table: string; filter?: string } = {
      event: "UPDATE", schema: "public", table: "registrations",
    };
    if (campusId) sub.filter = `campus_id=eq.${campusId}`;
    const channel = supabase
      .channel(`bus-attendance:${campusId ?? "all"}`)
      .on("postgres_changes", sub, (payload) => {
        const parsed = attendanceSnapshotSchema.safeParse(payload.new);
        if (!parsed.success || !membersById.has(parsed.data.id)) return;
        setChecks((current) => ({ ...current, values: mergeAttendance(current.values, [parsed.data]) }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [campusId, membersById]);

  const toggle = useCallback(async (id: string, field: AttendanceField) => {
    const key = `${id}:${field}`;
    if (!editable || requests.current.has(key)) return;
    const current = state[id] ?? membersById.get(id);
    if (!current) return;
    setSaving((pending) => ({ ...pending, [key]: true }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
    const next = !current[field];
    requests.current.add(key);
    const failed = () => {
      const member = membersById.get(id);
      setErrors((previous) => ({ ...previous, [key]: `${member?.name ?? "이 사람"} ${field === "checked_in" ? "상행 출발" : "하행 귀가"} 체크 요청을 완료하지 못했습니다. 현재 체크 상태와 연결을 확인한 뒤 다시 눌러 주세요.` }));
    };
    const unread = () => {
      unreadSaved.current.add(key);
      const member = membersById.get(id);
      setErrors((previous) => ({ ...previous, [key]: `${member?.name ?? "이 사람"} 체크는 저장되었습니다. 최신 상태를 불러오지 못했습니다. 연결을 확인한 뒤 이름을 다시 눌러 최신 상태를 확인해 주세요.` }));
    };
    try {
      if (!unreadSaved.current.has(key)) {
        const { error } = await createClient().rpc("set_attendance", {
          p_reg_id: id, p_field: field, p_value: next,
        });
        if (error) { failed(); return; }
        unreadSaved.current.add(key);
      }
      // The RPC returns void; only the actual committed revision can confirm a check.
      const { data, error } = await createClient().from("registrations")
        .select("id, checked_in, checked_out, version").eq("id", id).single();
      const parsed = attendanceSnapshotSchema.safeParse(data);
      if (error || !parsed.success) { unread(); return; }
      setChecks((previous) => ({ ...previous, values: mergeAttendance(previous.values, [parsed.data]) }));
      unreadSaved.current.delete(key);
    } catch { // no-excuse-ok: catch -- SDK/network boundary retains the established retry feedback.
      if (unreadSaved.current.has(key)) unread(); else failed();
    } finally {
      requests.current.delete(key);
      setSaving((pending) => ({ ...pending, [key]: false }));
    }
  }, [editable, membersById, state]);

  return { state, errors, saving, toggle };
}
