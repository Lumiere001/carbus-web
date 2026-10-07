"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { validateAttendancePlan } from "@/lib/registrations/attendance-plan";
import { X } from "lucide-react";
import { useConfirmation } from "@/components/ui/use-confirmation";
import { RegistrationCreateBasics } from "@/components/registrations/create/basics";
import { RegistrationCreateJourney } from "@/components/registrations/create/journey";
import { RegistrationCreateExtras } from "@/components/registrations/create/extras";
import { createCompleteRegistration } from "@/lib/registrations/create";
import type { CreateRegistrationInput } from "@/lib/registrations/create-schema";
import { isCompleteDateTime, toKst } from "@/lib/time/kst";
import type { EventTrip } from "@/lib/supabase/types";

export function RegForm({ eventId, campuses, trips, units, places, dayCount, lockedCampusId, onClose }: {
  readonly eventId: string | null;
  readonly campuses: { id: string; name: string }[];
  readonly trips: EventTrip[];
  readonly units: { id: string; name: string }[];
  readonly places: { id: number; name: string }[];
  readonly dayCount: number;
  readonly lockedCampusId?: string;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [draftEventId] = useState(eventId);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [validationPopup, setValidationPopup] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    if (!dialog) return;
    dialog.showModal();
    formRef.current?.querySelector<HTMLInputElement>("input[required]")?.focus();
    function revealInput() {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && formRef.current?.contains(focused)) focused.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("resize", revealInput);
    return () => {
      window.removeEventListener("resize", revealInput);
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  function goToSection(legend: string) {
    const target = Array.from(formRef.current?.querySelectorAll("legend") ?? []).find((item) => item.textContent === legend)?.parentElement;
    const disclosure = target?.closest("details");
    if (disclosure) disclosure.open = true;
    target?.scrollIntoView({ block: "start" });
    target?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)")?.focus({ preventScroll: true });
  }
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const [uncertain, setUncertain] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const [value, setValue] = useState<CreateRegistrationInput>({
    name: "", student_id: "", campus_id: lockedCampusId ?? campuses[0]?.id ?? "",
    up_trip_id: null, down_trip_id: null, payment_status: "unpaid", note: null,
    attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null, pickups: [], courses: [],
    legs: [],
  });
  function change(patch: Partial<CreateRegistrationInput>) {
    setError(""); setDirty(true); setValue((current) => ({ ...current, ...patch }));
  }
  function submit() {
    const incomplete = value.pickups.some((p) => p.pickup_at && !isCompleteDateTime(p.pickup_at));
    if (incomplete) { setError("픽업 날짜와 시각을 모두 입력하거나 둘 다 비워 주세요."); return; }
    const plan = { ...value, attend_from_at: toKst(value.attend_from_at), attend_to_at: toKst(value.attend_to_at) };
    const validation = validateAttendancePlan(plan);
    if (!validation.ok) {
      const message = validation.field === "legs" ? validation.message : "부분참은 참여 기간(시간 포함)을 입력해주세요! " + validation.message;
      setError(message); setValidationPopup(message); return;
    }
    setError("");
    start(async () => {
      const result = await createCompleteRegistration({ ...plan,
        campus_id: lockedCampusId ?? value.campus_id,
        pickups: value.pickups.map((p) => ({ ...p, pickup_at: toKst(p.pickup_at) })),
      }, draftEventId);
      if (!result.ok) { setError(result.message); setUncertain(Boolean(result.uncertain)); return; }
      onClose(); router.refresh();
    });
  }
  async function close() {
    if (dirty && !await requestConfirmation({ title: "입력한 신청을 닫을까요?", description: uncertain ? "저장이 완료되었을 수 있습니다. 입력을 닫아도 저장된 신청은 취소되지 않으니 명단을 확인해 주세요." : <span className="whitespace-nowrap">작성 중인 신청 정보가 사라집니다.</span>, confirmLabel: "입력 취소", tone: "danger" })) return;
    onClose();
  }
  async function confirmRetry() {
    router.refresh();
    if (await requestConfirmation({ title: "명단에 같은 신청이 없나요?", description: "먼저 명단을 확인해 주세요. 이미 추가되어 있다면 입력을 취소하고 그 신청을 편집하세요.", confirmLabel: "없는 것을 확인했어요" })) setUncertain(false);
  }
  return <>
    <dialog ref={dialogRef} aria-label="순장/순원 추가" aria-modal="true" onCancel={(event) => { event.preventDefault(); if (!pending) void close(); }}
      className="fixed inset-y-0 left-auto right-0 z-40 m-0 flex h-dvh max-h-none w-[calc(100%-1rem)] max-w-2xl flex-col border-0 border-l border-border bg-surface p-0 text-foreground backdrop:bg-black/40">
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-normal">순장/순원 추가</h2><p className="mt-1 text-sm text-muted">모든 입력은 함께 저장됩니다.</p></div><Button type="button" variant="ghost" size="icon" aria-label="신청 입력 닫기" title="신청 입력 닫기" disabled={pending} onClick={() => void close()}><X size={18} /></Button></div>
        <nav aria-label="신청 입력 항목" className="mt-3 flex flex-wrap gap-2">
          {[{ label: "기본 정보", legend: "기본 정보" }, { label: "참여 기간", legend: "참여 예정 일정" }, { label: "이동수단", legend: "이동수단" }, { label: `수송 요청 ${value.pickups.length}`, legend: "수송 요청" }, { label: `수강신청 ${value.courses.length}`, legend: "수강신청" }].map((section) => <Button key={section.legend} type="button" size="sm" variant="secondary" disabled={pending} aria-label={`${section.legend} 입력으로 이동`} onClick={() => goToSection(section.legend)}>{section.label}</Button>)}
        </nav>
      </div>
      <form ref={formRef} data-saving={pending} data-unsaved={dirty} className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}
          {uncertain && <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" onClick={() => router.refresh()}>명단 새로고침</Button><Button type="button" variant="ghost" onClick={() => void confirmRetry()}>명단 확인 후 다시 저장</Button></div>}
          <fieldset disabled={pending} className="min-w-0 space-y-4">
            <RegistrationCreateBasics value={value} onChange={change} campuses={campuses} trips={trips} lockedCampusId={lockedCampusId} />
            <RegistrationCreateJourney value={value} onChange={change} units={units} />
            <RegistrationCreateExtras value={value} onChange={change} places={places} dayCount={dayCount} />
          </fieldset>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-surface p-4"><Button type="submit" disabled={pending || uncertain}>{pending ? "저장 중…" : "신청 추가"}</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => void close()}>취소</Button><span className="ml-auto text-xs text-muted-2">{pending ? "저장 확인 중…" : uncertain ? "저장 여부를 확인하세요." : "부분 참석·편도는 일정과 이동수단 필수"}</span></div>
      </form>
    </dialog>
    <ConfirmDialog open={Boolean(validationPopup)} title="신청 정보를 확인해 주세요" description={validationPopup} confirmLabel="확인" onCancel={() => setValidationPopup("")} onConfirm={() => setValidationPopup("")} />
    {confirmationDialog}
  </>;
}
