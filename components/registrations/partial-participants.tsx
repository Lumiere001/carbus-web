"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { partialFilters, matchesPartialFilter, type PartialFilter } from "./partial-filters";
import { useRouter } from "next/navigation";
import { useRegistrationEditor } from "./use-registration-editor";
import { PartialList } from "@/components/admin/partial-list";
import { RegDrawer } from "@/components/admin/reg-drawer";
import { DEFAULT_LEG } from "@/components/admin/transport-picker";
import type { PartialEditorData } from "./partial-editor-data";

export function PartialParticipants({ data, rows, title, canEdit, campusId }: {
  readonly data: PartialEditorData;
  readonly rows: PartialEditorData["rows"];
  readonly title: string;
  readonly canEdit: boolean;
  readonly campusId?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<PartialFilter>("all");
  const shown = campusId ? rows.filter((item) => matchesPartialFilter(filter, item)) : rows;
  // 편집 결과가 현재 필터에서 빠져도 저장 완료·다음 입력·닫기가 중단되지 않는다.
  const { drawerId, openRegistration, closeRegistration } = useRegistrationEditor(data.editorRows, campusId);
  const row = data.editorRows.find((item) => item.id === drawerId);
  return <>
    {campusId && <nav aria-label="부분 참석 조건" className="flex flex-wrap gap-2">{partialFilters.map((item) => <Button key={item.key} type="button" variant={filter === item.key ? "secondary" : "ghost"} aria-pressed={filter === item.key}
      onClick={() => setFilter(item.key)}>{item.label} {rows.filter((row) => matchesPartialFilter(item.key, row)).length}</Button>)}</nav>}
    <PartialList rows={shown} title={title} canEdit={canEdit} trips={data.trips}
      startsOn={data.startsOn} endsOn={data.endsOn} onEdit={openRegistration} />
    {canEdit && row && <RegDrawer key={row.id} row={row} campuses={data.campuses} trips={data.trips}
      units={data.units} upLeg={data.legs[`${row.id}:up`] ?? DEFAULT_LEG} downLeg={data.legs[`${row.id}:down`] ?? DEFAULT_LEG}
      pickups={data.pickups[row.id] ?? []} places={data.places} courses={data.courses[row.id] ?? []}
      journeyLegs={(["up", "down"] as const).flatMap((direction) => {
        const raw = data.legs[`${row.id}:${direction}`];
        return raw ? [{ direction, mode: raw.mode, status: raw.status, via_unit_id: raw.viaUnitId }] : [];
      })} dayCount={data.dayCount} variant={campusId ? "campus" : "master"} includeBasics
      onSaved={() => router.refresh()} onClose={closeRegistration} />}
  </>;
}
