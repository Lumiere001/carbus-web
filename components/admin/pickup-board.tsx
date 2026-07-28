import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TriangleAlert } from "lucide-react";

export type BoardRow = {
  id: number | null;
  direction: string | null;
  pickup_at: string | null;
  pickup_date: string | null;
  pickup_time: string | null;
  place: string | null;
  note: string | null;
  person_name: string | null;
  campus_name: string | null;
};

/**
 * 수송 요청 보드 (§11-C 의 D).
 *
 * **(날짜, 시각, 장소) 로 묶으면 그대로 간사 차량 배차표가 된다.** 그게 이 화면의
 * 전부다 — 사람 단위로 흩어져 있으면 "화요일 밤 10시에 역으로 몇 명 나가야 하나"를
 * 아무도 못 본다.
 *
 * **시각 미정 묶음을 맨 위에 빨강으로 둔다.** 그게 곧 다음에 물어봐야 할 사람들의
 * 명단이다. 시각을 필수로 받았다면 아무 값이나 찍혀서 이 명단이 아예 존재하지
 * 않았을 것이다.
 */
export function PickupBoard({
  rows,
  venueName,
}: {
  rows: BoardRow[];
  /** 행사 목적지 이름. 방향을 "어디서 어디로" 로 적기 위해. */
  venueName?: string | null;
}) {
  const venue = venueName?.trim() || "행사장";
  const groups = new Map<string, { date: string | null; time: string | null; place: string | null; members: BoardRow[] }>();
  for (const r of rows) {
    // 장소도 미정일 수 있다. 시각·장소가 둘 다 없으면 한 묶음으로 모인다.
    const key = `${r.pickup_date ?? ""}|${r.pickup_time ?? ""}|${r.place ?? ""}`;
    const g = groups.get(key);
    if (g) g.members.push(r);
    else
      groups.set(key, {
        date: r.pickup_date,
        time: r.pickup_time,
        place: r.place,
        members: [r],
      });
  }

  const list = [...groups.values()].sort((a, b) => {
    // 시각 미정이 위로 — 정렬이 아니라 우선순위다.
    const au = a.date == null ? 0 : 1;
    const bu = b.date == null ? 0 : 1;
    if (au !== bu) return au - bu;
    return (
      (a.date ?? "").localeCompare(b.date ?? "") ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      (a.place ?? "").localeCompare(b.place ?? "")
    );
  });

  const undecided = rows.filter((r) => r.pickup_at == null).length;

  return (
    <Card
      title="수송 요청 보드"
      subtitle={`${rows.length}건 · 날짜·시각·장소로 묶음 (그대로 차량 배차표)`}
    >
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-2">
          아직 수송 요청이 없습니다. 전체 순장/순원 화면에서 사람을 열고
          <b> 수송 요청</b>을 추가하면 여기에 묶여서 보입니다.
        </p>
      ) : (
        <>
          {undecided > 0 && (
            <div className="px-5 py-3 text-sm text-danger flex items-start gap-2 border-b border-border bg-danger-bg/40">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                <b>{undecided}건</b>이 시각 미정입니다. 이 사람들에게 도착 시각을 먼저
                물어봐야 차량을 짤 수 있습니다.
              </span>
            </div>
          )}
          <div className="divide-y divide-border">
            {list.map((g, i) => {
              const undecidedGroup = g.date == null;
              return (
                <div key={i} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        "text-sm font-semibold " +
                        (undecidedGroup ? "text-danger" : "text-foreground")
                      }
                    >
                      {undecidedGroup
                        ? "시각 미정"
                        : `${g.date} ${g.time ?? ""}`.trim()}
                    </span>
                    <span className="text-sm text-muted">
                      {g.place ?? "장소 미정"}
                    </span>
                    <Badge variant={undecidedGroup ? "danger" : "primary"} dot={false}>
                      {g.members.length}명
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                    {g.members.map((m) => (
                      <span key={m.id} className="whitespace-nowrap">
                        {m.person_name}
                        <span className="text-muted-2 text-xs ml-1">
                          {m.campus_name}
                          {m.direction === "down"
                            ? ` · ${venue} →`
                            : ` · → ${venue}`}
                        </span>
                        {m.note && (
                          <span className="text-muted-2 text-xs ml-1">({m.note})</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
