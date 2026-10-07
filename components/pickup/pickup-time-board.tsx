import { TimeBoard } from "@/components/schedule/time-board";
import type { BoardRow, Audience } from "./pickup-board";

export function PickupTimeBoard({ rows, audience }: { readonly rows: readonly BoardRow[]; readonly audience: Audience }) {
  const dates = [...new Set(rows.map((row) => row.pickup_date ?? ""))].sort();
  const groups = new Map<string, BoardRow[]>();
  for (const row of rows) {
    const key = `${row.pickup_date ?? ""}|${row.pickup_time?.slice(0, 5) ?? ""}|${row.place ?? ""}|${row.direction ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  const admin = audience === "admin";
  return <TimeBoard label="수송 요청" days={dates.map((date) => ({ key: date, date: date || null, label: date ? "수송 요청" : "날짜 미정" }))}
    entries={[...groups].flatMap(([key, members]) => {
      const first = members[0];
      if (!first) return [];
      return [{ key, day: first.pickup_date ?? "", time: first.pickup_time, count: members.length,
        content: <section className="rounded-md bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground"><b>{first.place ?? "장소 미정"}</b><span className="text-xs text-muted">{first.direction === "down" ? "수련회장 출발" : "수련회장 도착"} · {members.length}건</span></div>
          {admin && first.place_note && <p className="mt-1 text-xs text-muted">{first.place_note}</p>}
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
            {members.map((member, index) => <li key={member.id ?? index} className="min-w-0 max-w-full">
              <span className="text-foreground">{member.person_name ?? "이름 미정"}</span>
              {admin && <span className="ml-1 text-xs text-muted">{member.campus_name}{member.student_id ? ` · ${member.student_id}` : ""}</span>}
              {admin && (member.attend_from || member.attend_to) && <span className="ml-1 text-xs text-muted">· 참여 {member.attend_from ?? "처음"}~{member.attend_to ?? "끝"}</span>}
              {member.note && <p role="note" aria-label="수송 메모" className="mt-1 whitespace-pre-wrap text-sm text-foreground"><span className="mr-2 text-xs text-muted">수송 메모</span>{member.note}</p>}
            </li>)}
          </ul>
        </section>,
      }];
    })} />;
}
