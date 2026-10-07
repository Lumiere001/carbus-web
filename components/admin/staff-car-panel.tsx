"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useConfirmation } from "@/components/ui/use-confirmation";
import { setFixedPassengers, type BusRow, type BusPinMode } from "@/lib/admin/buses";
import type { CandidateData } from "./buses-panel";
import { sortRoster } from "@/lib/registrations/roster-sort";

export type StaffVehicle = Pick<BusRow, "id" | "name" | "kind" | "up_trip_id" | "down_trip_id" | "hard_cap" | "driver_registration_id" | "down_driver_registration_id" | "fixed_passenger_ids" | "down_fixed_passenger_ids">;
function assignedCount(car: StaffVehicle, mode: BusPinMode): number {
  const driver = mode === "up" ? car.driver_registration_id : car.down_driver_registration_id;
  const fixed = mode === "up" ? car.fixed_passenger_ids : car.down_fixed_passenger_ids;
  return new Set([...fixed, ...(driver ? [driver] : [])]).size;
}
export function StaffCarPanel({ vehicles, people, isMaster }: {
  readonly vehicles: readonly StaffVehicle[];
  readonly people: readonly CandidateData[];
  readonly isMaster: boolean;
}) {
  const router = useRouter();
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const [mode, setMode] = useState<BusPinMode>("up");
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const cars = vehicles.filter((car) => car.kind === "staff_car" && (mode === "up" ? car.up_trip_id : car.down_trip_id) != null);
  const car = cars.find((item) => item.id === selected) ?? cars[0];
  const driverId = car ? mode === "up" ? car.driver_registration_id : car.down_driver_registration_id : null;
  const fixedIds = car ? mode === "up" ? car.fixed_passenger_ids : car.down_fixed_passenger_ids : [];
  const lookup = new Map(people.map((person) => [person.id, person]));
  const search = query.replace(/\s/g, "").toLocaleLowerCase();
  const matches = search ? sortRoster([...people]).filter((person) => `${person.name}${person.student_id}${person.campus_name}`.replace(/\s/g, "").toLocaleLowerCase().includes(search)) : [];
  const direction = mode === "up" ? "상행" : "하행";
  const occupied = car ? assignedCount(car, mode) : 0;

  async function toggle(person: CandidateData) {
    if (!car || pending || !isMaster) return;
    const target = car;
    const adding = !fixedIds.includes(person.id);
    const old = vehicles.find((vehicle) => vehicle.id !== target.id && (mode === "up" ? vehicle.fixed_passenger_ids : vehicle.down_fixed_passenger_ids).includes(person.id));
    if (adding && old && !(await requestConfirmation({ title: "고정 탑승 차량을 변경할까요?", description: `${person.name}의 ${direction} 고정 탑승 차량을 ${old.name}에서 ${target.name}으로 변경합니다.`, confirmLabel: "차량 변경" }))) return;
    const state = { busId: target.id, mode, driverId, fixedIds };
    const next = adding ? [...fixedIds, person.id] : fixedIds.filter((id) => id !== person.id);
    setMessage(null);
    startTransition(async () => {
      const result = await setFixedPassengers(state, next);
      if (!result.ok) { setMessage({ ok: false, text: result.message }); return; }
      setMessage({ ok: true, text: `${person.name} · ${target.name} ${direction} 고정 탑승 ${adding ? "지정" : "해제"} 완료` });
      router.refresh();
    });
  }

  return <Card title="간사 차량 탑승자 배정" subtitle="방향과 차량을 고른 뒤 사람을 검색해 지정합니다. 총단만 변경할 수 있습니다.">
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2" aria-label="간사 차량 배정 방향">{(["up", "down"] as const).map((value) => <Button key={value} variant={mode === value ? "default" : "secondary"} disabled={pending} aria-pressed={mode === value} onClick={() => { setMode(value); setSelected(null); setQuery(""); setMessage(null); }}>{value === "up" ? "상행 (가는 편)" : "하행 (오는 편)"}</Button>)}</div>
        <label className="flex min-w-0 flex-col gap-1 text-sm">간사 차량<select className="min-h-11 max-w-full rounded-md border border-border bg-surface px-3" value={car?.id ?? ""} disabled={pending || cars.length === 0} onChange={(event) => { setSelected(Number(event.target.value)); setQuery(""); setMessage(null); }} aria-label="배정할 간사 차량">
          {cars.length === 0 && <option value="">이 방향의 간사 차량 없음</option>}{cars.map((item) => <option key={item.id} value={item.id}>{item.name} · 남은 {Math.max(0, item.hard_cap - assignedCount(item, mode))}/{item.hard_cap}석</option>)}
        </select></label>
      </div>
      {message && <p role={message.ok ? "status" : "alert"} className={`rounded-md border border-border p-3 text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
      {!car ? <p className="text-sm text-muted">운행편·차량 편성에서 간사 차량의 {direction} 운행편을 지정해 주세요.</p> : <>
        <div className="rounded-lg border border-border p-3">
          <h3 className="text-base font-medium">{car.name} · {direction} 고정 탑승자</h3>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted"><span>배정 {occupied}명</span><span>최대 {car.hard_cap}석</span><span className={occupied >= car.hard_cap ? "text-warning" : "text-foreground"}>남은 {Math.max(0, car.hard_cap - occupied)}석</span></p>
          {occupied >= car.hard_cap && <p className="mt-2 text-sm text-warning"><span className="inline-block">이 차량의 좌석이 모두 배정됐습니다.</span> <span className="inline-block">다른 차량을 선택하거나 기존 고정 탑승자를 해제해 주세요.</span></p>}
          {driverId && <p className="mt-2 text-sm text-muted">차량순장: {lookup.get(driverId)?.name ?? "명단 확인 필요"}</p>}
          {fixedIds.length === 0 ? <p className="mt-2 text-sm text-muted">고정 탑승자가 없습니다. 아래에서 사람을 검색해 추가하세요.</p> : <ul className="mt-2 divide-y divide-border">{fixedIds.map((id) => {
            const person = lookup.get(id);
            return <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-sm">{person?.name ?? "명단 확인 필요"} <span className="text-xs text-muted">{person?.campus_name} {person?.student_id}</span></span>{isMaster && person && <Button variant="secondary" disabled={pending} onClick={() => { void toggle(person); }} aria-label={`${person.name} ${direction} 고정 해제`}>고정 해제</Button>}</li>;
          })}</ul>}
        </div>
        {isMaster && <div className="space-y-2">
          <label className="block text-sm">추가할 사람 찾기<input type="search" value={query} disabled={pending} onChange={(event) => setQuery(event.target.value)} placeholder="이름·학번·캠퍼스" className="mt-1 block min-h-11 w-full rounded-md border border-border bg-surface px-3" /></label>
          <p className="text-xs text-muted">역할을 먼저 부여할 필요가 없습니다. 고정 지정과 실제 간사 차량 배정이 함께 저장됩니다.</p>
          {!search ? <p className="py-2 text-sm text-muted">이름·학번·캠퍼스를 입력해 사람을 찾으세요.</p> : matches.length === 0 ? <p className="py-2 text-sm text-muted">검색 결과가 없습니다. 검색어를 바꿔 주세요.</p> : <div><p className="mb-2 text-xs text-muted">검색 결과 {matches.length}명 · 캠퍼스·학번·이름순</p><ul className="max-h-80 divide-y divide-border overflow-y-auto overscroll-contain" aria-label="간사 차량 배정 검색 결과">{matches.map((person) => {
            const fixed = fixedIds.includes(person.id);
            const driver = vehicles.find((vehicle) => (mode === "up" ? vehicle.driver_registration_id : vehicle.down_driver_registration_id) === person.id);
            const current = vehicles.find((vehicle) => (mode === "up" ? vehicle.fixed_passenger_ids : vehicle.down_fixed_passenger_ids).includes(person.id));
            return <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div className="text-sm"><span>{person.name}</span> <span className="text-xs text-muted">{person.campus_name} · {person.student_id}</span>{(current || driver) && <p className="mt-1 text-xs text-muted">현재 {driver?.name ?? current?.name} · {driver ? "차량순장" : "고정 탑승"}</p>}</div><Button variant="secondary" disabled={pending || fixed || Boolean(driver) || occupied >= car.hard_cap} onClick={() => { void toggle(person); }} aria-label={`${person.name} ${car.name} ${direction} 고정 지정`}>{fixed ? "지정됨" : driver ? "차량순장 지정 중" : occupied >= car.hard_cap ? "차량 만석" : current ? "이 차로 변경" : "고정 지정"}</Button></li>;
          })}</ul></div>}
        </div>}
      </>}
    </div>{confirmationDialog}
  </Card>;
}
