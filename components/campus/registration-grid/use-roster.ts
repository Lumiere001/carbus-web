"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useServerRows } from "@/components/registrations/use-server-rows";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import { newerRegistration, reconcileRegistrationRows, retainMissingRegistrationRows } from "./versions";

/** The page remounts this roster when event or campus changes. */
export function useRegistrationRoster(campusId: string, eventId: string | null, initialRows: RegistrationRow[]) {
  const [rows, setRows] = useServerRows(initialRows, retainMissingRegistrationRows);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [checkingMembership, setCheckingMembership] = useState(false);
  const previousSource = useRef(initialRows);
  const session = useRef({ active: true, epoch: 0, busy: false, reread: false });

  const confirmMembership = useCallback(async () => {
    const state = session.current;
    if (!state.active) return;
    if (state.busy) { state.reread = true; return; }
    if (!eventId) {
      setMembershipError("행사 범위를 확인하지 못했습니다. 화면을 새로고침해 주세요.");
      return;
    }
    state.busy = true;
    setCheckingMembership(true);
    try {
      do {
        state.reread = false;
        const epoch = state.epoch;
        const { data, error } = await createClient().from("registrations").select("*")
          .eq("campus_id", campusId).eq("event_id", eventId).order("created_at", { ascending: true });
        if (!state.active) return;
        if (epoch !== state.epoch || state.reread) { state.reread = true; continue; }
        if (error || !data) throw new Error("Roster confirmation failed");
        setRows((current) => reconcileRegistrationRows(data, current));
        setMembershipError(null);
      } while (state.reread);
    } catch {
      if (state.active) setMembershipError("최신 명단을 확인하지 못했습니다. 기존 명단을 유지하고 있습니다. 다시 확인하거나 화면을 새로고침해 주세요.");
    } finally {
      state.busy = false;
      if (state.active) setCheckingMembership(false);
    }
  }, [campusId, eventId, setRows]);

  useEffect(() => {
    const state = session.current;
    state.active = true;
    const supabase = createClient();
    const channel = supabase.channel(`registrations:${eventId}:${campusId}`).on("postgres_changes", {
      event: "*", schema: "public", table: "registrations", filter: `campus_id=eq.${campusId}`,
    }, (payload) => {
      if (payload.eventType === "DELETE") {
        const old = payload.old as { id: string };
        state.epoch += 1;
        setRows((current) => current.filter((row) => row.id !== old.id));
        return;
      }
      const row = payload.new as RegistrationRow;
      if (row.event_id !== eventId || row.campus_id !== campusId) return;
      if (payload.eventType === "INSERT") {
        // Even duplicate membership notifications conservatively invalidate an in-flight read.
        state.epoch += 1;
        setRows((current) => current.some((existing) => existing.id === row.id) ? current : [...current, row]);
      } else if (payload.eventType === "UPDATE") {
        setRows((current) => current.map((existing) => existing.id === row.id ? newerRegistration(existing, row) : existing));
      }
    }).subscribe();
    return () => { state.active = false; state.epoch += 1; supabase.removeChannel(channel); };
  }, [campusId, eventId, setRows]);

  useEffect(() => {
    if (previousSource.current === initialRows) return;
    previousSource.current = initialRows;
    session.current.epoch += 1;
    const ids = new Set(initialRows.map((row) => row.id));
    if (session.current.busy || rows.some((row) => !ids.has(row.id))) void confirmMembership();
  }, [initialRows, rows, confirmMembership]);

  return { rows, setRows, membershipError, checkingMembership, confirmMembership };
}
