"use client";

import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import { cn } from "@/lib/utils";
import type { useRegistrationColumns } from "./columns";

// 열 너비 (시안 §2): 학번 w-20, 참석/일정 w-48(슬롯 라벨 길어짐), 차량비 w-24.
const colClass: Readonly<Record<string, string>> = {
    name: "w-20 sm:w-32 sticky left-0 z-10 bg-surface",
    student_id: "w-20",
    attendance: "w-48",
    note: "w-40",
    fee: "w-24 text-right",
    payment_status: "w-28",
    assigned_up_bus_id: "w-24",
    assigned_down_bus_id: "w-24",
    actions: "w-28 sm:w-44 sticky right-0 z-10 bg-surface",
  } as const;


export function RegistrationGridTable({ visibleRows, columns, listView }: {
  readonly visibleRows: RegistrationRow[];
  readonly columns: ReturnType<typeof useRegistrationColumns>;
  readonly listView: string;
}) {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: visibleRows, columns, getCoreRowModel: getCoreRowModel() });
  return (
        <div className="max-h-[560px] overflow-auto flex-1 min-w-0">
          <table className="w-full min-w-[1100px] table-fixed text-sm" onFocusCapture={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && !target.closest("td")?.classList.contains("sticky")) target.scrollIntoView({ block: "nearest", inline: "center" });
          }}>
            <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="text-left">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className={cn(
                        "whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted",
                        colClass[h.column.id]
                      )}
                    >
                      {h.isPlaceholder
                        ? null
                        : flexRender(
                            h.column.columnDef.header,
                            h.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {visibleRows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-6 text-muted">{listView === "cancelled" ? "취소된 신청이 없습니다." : "표시할 신청이 없습니다."}</td></tr>}
              {table.getRowModel().rows.map((r) => (
                <tr
                  key={r.id}
                  className="group border-b border-border transition hover:bg-surface-2/60"
                >
                  {r.getVisibleCells().map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        colClass[c.column.id]
                      )}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}

            </tbody>
          </table>
        </div>

  );
}
