"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeOnsite, onsiteCommandSchema, onsiteSnapshotSchema } from "@/lib/onsite/model";
import type { OnsiteCommand, OnsiteSnapshot, OnsiteState } from "@/lib/onsite/model";
import type { ReactNode } from "react";

type WriteResult = { readonly ok: true } | { readonly ok: false; readonly message: string };
type PendingRequest = {
  readonly id: string;
  readonly expected_revision: number;
  readonly command: OnsiteCommand;
};
type Context = {
  readonly states: OnsiteSnapshot;
  readonly canEdit: boolean;
  readonly pending: ReadonlySet<string>;
  readonly uncertain: ReadonlySet<string>;
  readonly save: (state: OnsiteState, command: OnsiteCommand) => Promise<WriteResult>;
  readonly retry: (registrationId: string) => Promise<WriteResult>;
};
const OnsiteContext = createContext<Context | null>(null);

export function OnsiteProvider({ eventId, initial, canEdit, children }: {
  readonly eventId: string;
  readonly initial: OnsiteSnapshot;
  readonly canEdit: boolean;
  readonly children: ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [states, setStates] = useState(initial);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [uncertain, setUncertain] = useState<ReadonlySet<string>>(new Set());
  const [refreshError, setRefreshError] = useState("");
  const requests = useRef(new Map<string, PendingRequest>());
  const inFlight = useRef(new Set<string>());
  const refreshing = useRef(false);
  const channelId = useId();
  const ids = useMemo(() => initial.map((state) => state.registration_id), [initial]);
  const accept = useCallback((incoming: OnsiteSnapshot) => setStates((current) => mergeOnsite(current, incoming)), []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
    const { data, error } = await supabase.rpc("onsite_snapshot", { p_event: eventId, p_reg_ids: ids });
    const parsed = onsiteSnapshotSchema.safeParse(data);
    if (error || !parsed.success) {
      setRefreshError("최신 현장 기록을 불러오지 못했습니다. 연결을 확인하고 다시 불러오세요.");
      return;
    }
    accept(parsed.data);
    setRefreshError("");
    } finally { refreshing.current = false; }
  }, [accept, eventId, ids, supabase]);

  useEffect(() => {
    const channel = supabase.channel(`onsite:${eventId}:${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "onsite_states", filter: `event_id=eq.${eventId}` }, () => { void refresh(); })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRefreshError("실시간 연결이 끊겼습니다. 최신 기록을 다시 불러오세요.");
      });
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    // Realtime cannot carry a viewed-event HTTP header; keep past-event screens current too.
    const poll = window.setInterval(onFocus, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.clearInterval(poll); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); void supabase.removeChannel(channel); };
  }, [channelId, eventId, refresh, supabase]);

  async function send(registrationId: string, request: PendingRequest): Promise<WriteResult> {
    if (inFlight.current.has(registrationId)) return { ok: false, message: "저장 중입니다." };
    inFlight.current.add(registrationId);
    setPending(new Set(inFlight.current));
    try {
      const { data, error } = await supabase.rpc("record_onsite", {
        p_event: eventId, p_reg: registrationId, p_request: request.id,
        p_input: { ...request.command, expected_revision: request.expected_revision },
      });
      if (error) {
        // PostgREST/transport errors can leave commit status unknown. Retry the same UUID.
        if (/^(40|22|23|42)/.test(error.code)) {
          requests.current.delete(registrationId);
          setUncertain(new Set(requests.current.keys()));
          await refresh();
          return { ok: false, message: error.message };
        }
        return { ok: false, message: "응답을 확인하지 못했습니다. 같은 요청 확인을 눌러 저장 여부를 확인하세요." };
      }
      const parsed = onsiteSnapshotSchema.safeParse(data);
      if (!parsed.success || !parsed.data.some((state) => state.registration_id === registrationId)) return { ok: false, message: "저장 응답을 읽지 못했습니다. 같은 요청 확인으로 다시 확인하세요." };
      accept(parsed.data);
      requests.current.delete(registrationId);
      setUncertain(new Set(requests.current.keys()));
      return { ok: true };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { ok: false, message: "연결 오류로 응답을 확인하지 못했습니다. 같은 요청 확인으로 다시 확인하세요." };
    } finally {
      inFlight.current.delete(registrationId);
      setPending(new Set(inFlight.current));
    }
  }
  async function save(state: OnsiteState, input: OnsiteCommand): Promise<WriteResult> {
    if (!canEdit) return { ok: false, message: "조회 전용입니다." };
    if (requests.current.has(state.registration_id)) return { ok: false, message: "이전 요청의 저장 여부를 먼저 확인하세요." };
    const parsed = onsiteCommandSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "날짜·시각과 정정 사유를 확인하세요." };
    const request = { id: crypto.randomUUID(), expected_revision: state.revision, command: parsed.data };
    requests.current.set(state.registration_id, request);
    setUncertain(new Set(requests.current.keys()));
    return send(state.registration_id, request);
  }
  async function retry(registrationId: string): Promise<WriteResult> {
    const request = requests.current.get(registrationId);
    return request ? send(registrationId, request) : { ok: false, message: "다시 확인할 요청이 없습니다." };
  }
  return <OnsiteContext value={{ states: mergeOnsite(states, initial), canEdit, pending, uncertain, save, retry }}>
    {refreshError && <div role="alert" className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
      <p>{refreshError}</p><button type="button" className="mt-1 min-h-11 px-2 underline" onClick={() => { void refresh(); }}>최신 기록 다시 불러오기</button>
    </div>}
    {children}
  </OnsiteContext>;
}

export function useOnsite() { return useContext(OnsiteContext); }
