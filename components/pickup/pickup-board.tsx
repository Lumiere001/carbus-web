"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TriangleAlert, ChevronDown, ChevronRight } from "lucide-react";

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
  /** 아래 넷은 **관리자 화면에서만** 쓴다. 임역원은 안 넘긴다. */
  student_id?: string | null;
  place_note?: string | null;
  attend_from?: string | null;
  attend_to?: string | null;
};

/**
 * 누가 보는 화면인가. **데이터 범위가 아니라 표시 항목을 가른다** —
 * 범위는 각 페이지의 쿼리(그리고 RLS)가 정한다.
 *
 * - `campus` 임역원: 전부 자기 캠퍼스 사람이라 **캠퍼스 이름이 매 줄 반복되면
 *   소음**이다. 뺀다. 필요한 건 누가·어디로·언제·비고뿐이다.
 * - `admin` 총단: 캠퍼스가 **핵심 정보**다(어느 캠퍼스에서 몇 명 나오는지로 차를
 *   짠다). 학번·장소 안내·참여기간까지 등록된 것을 다 보여준다.
 */
export type Audience = "admin" | "campus";

/**
 * 수송 요청 보드 — 관리자·임역원이 함께 쓴다.
 *
 * **묶으면 그대로 차량 배차표가 된다.** 사람 단위로 흩어져 있으면 "화요일 밤 10시에
 * 역으로 몇 명 나가야 하나" 를 아무도 못 본다.
 *
 * 묶는 축이 둘이라 **전환할 수 있게** 한다:
 *   - `시각별` — (날짜·시각·장소). 차를 언제 몇 대 보낼지 짤 때. 관리자 기본값.
 *   - `장소별` — 장소 밑에 시각. "우리 지구 사람들이 어디로 모이나" 를 볼 때.
 *     임역원 기본값이다(동규님 요청).
 *
 * ⚠️ **시각 미정 묶음은 항상 맨 위, 빨강이다.** 그게 곧 다음에 물어봐야 할 사람들의
 * 명단이다. 시각을 필수로 받았다면 아무 값이나 찍혀서 이 명단이 아예 없었을 것이다.
 *
 * ⚠️ 인원이 늘면 세로로 한없이 길어진다. 그래서 **위에 요약 줄을 두고, 묶음은 접을 수
 * 있게** 했다. 요약의 칩을 누르면 그 묶음만 펼쳐지며 그리로 이동한다 — 스크롤을
 * 끝까지 내려 찾지 않아도 된다.
 */
export function PickupBoard({
  rows,
  audience,
  defaultGroupBy = "time",
  title = "수송 요청 보드",
  emptyHint,
}: {
  rows: BoardRow[];
  audience: Audience;
  defaultGroupBy?: "time" | "place";
  title?: string;
  emptyHint?: string;
}) {
  const isAdmin = audience === "admin";
  const [groupBy, setGroupBy] = useState<"time" | "place">(defaultGroupBy);
  /** 접힌 묶음의 키. 기본은 전부 펼침 — 접는 건 사람이 정한다. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const list = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; date: string | null; time: string | null; place: string | null; members: BoardRow[] }
    >();
    for (const r of rows) {
      // 장소도 미정일 수 있다. 시각·장소가 둘 다 없으면 한 묶음으로 모인다.
      const key = `${r.pickup_date ?? ""}|${r.pickup_time ?? ""}|${r.place ?? ""}`;
      const g = groups.get(key);
      if (g) g.members.push(r);
      else
        groups.set(key, {
          key,
          date: r.pickup_date,
          time: r.pickup_time,
          place: r.place,
          members: [r],
        });
    }
    return [...groups.values()].sort((a, b) => {
      // 시각 미정이 위로 — 정렬이 아니라 우선순위다.
      const au = a.date == null ? 0 : 1;
      const bu = b.date == null ? 0 : 1;
      if (au !== bu) return au - bu;
      if (groupBy === "place") {
        return (
          (a.place ?? "").localeCompare(b.place ?? "") ||
          (a.date ?? "").localeCompare(b.date ?? "") ||
          (a.time ?? "").localeCompare(b.time ?? "")
        );
      }
      return (
        (a.date ?? "").localeCompare(b.date ?? "") ||
        (a.time ?? "").localeCompare(b.time ?? "") ||
        (a.place ?? "").localeCompare(b.place ?? "")
      );
    });
  }, [rows, groupBy]);

  /** 위 요약 줄 — 묶는 축에 맞춰 센다. 누르면 그 묶음으로 간다. */
  const summary = useMemo(() => {
    const m = new Map<string, { label: string; count: number; firstKey: string; undecided: boolean }>();
    for (const g of list) {
      const label =
        groupBy === "place"
          ? g.place ?? "장소 미정"
          : g.date == null
            ? "시각 미정"
            : `${g.date} ${g.time ?? ""}`.trim();
      const cur = m.get(label);
      if (cur) cur.count += g.members.length;
      else
        m.set(label, {
          label,
          count: g.members.length,
          firstKey: g.key,
          undecided: g.date == null,
        });
    }
    return [...m.values()];
  }, [list, groupBy]);

  const undecided = rows.filter((r) => r.pickup_at == null).length;

  const jump = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(key); // 접혀 있었으면 펼치고 간다
      return next;
    });
    // 렌더 뒤에 스크롤한다 — 접힌 걸 펼치면서 높이가 바뀐다.
    requestAnimationFrame(() => {
      document
        .getElementById(`pickup-${cssId(key)}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allCollapsed = list.length > 0 && list.every((g) => collapsed.has(g.key));

  return (
    <Card
      title={title}
      subtitle={`${rows.length}건 · ${groupBy === "place" ? "장소별" : "날짜·시각별"} 묶음`}
    >
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-2">
          {emptyHint ??
            "아직 수송 요청이 없습니다. 전체 순장/순원 화면에서 사람을 열고 수송 요청을 추가하면 여기에 묶여서 보입니다."}
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

          {/* 요약 줄 — 스크롤을 끝까지 내리지 않고도 어디에 몇 명인지 보이고,
              누르면 그 묶음으로 바로 간다. */}
          <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-md border border-border overflow-hidden mr-1">
              {(["time", "place"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setGroupBy(k)}
                  className={
                    "px-2.5 py-1 text-xs " +
                    (groupBy === k
                      ? "bg-primary-100 text-primary-700 font-medium"
                      : "text-muted hover:bg-surface-2")
                  }
                >
                  {k === "time" ? "시각별" : "장소별"}
                </button>
              ))}
            </div>
            {summary.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => jump(s.firstKey)}
                className={
                  "text-xs rounded-full border px-2.5 py-1 " +
                  (s.undecided
                    ? "border-danger-300 text-danger hover:bg-danger-bg/40"
                    : "border-border text-muted hover:bg-surface-2")
                }
                title="눌러서 그 묶음으로 이동"
              >
                {s.label} <b className="tabular-nums">{s.count}</b>
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setCollapsed(allCollapsed ? new Set() : new Set(list.map((g) => g.key)))
              }
              className="ml-auto text-xs text-muted hover:text-foreground underline"
            >
              {allCollapsed ? "모두 펼치기" : "모두 접기"}
            </button>
          </div>

          <div className="divide-y divide-border">
            {list.map((g) => {
              const undecidedGroup = g.date == null;
              const isCollapsed = collapsed.has(g.key);
              return (
                <div key={g.key} id={`pickup-${cssId(g.key)}`} className="px-5 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    className="flex flex-wrap items-center gap-2 w-full text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} className="text-muted-2 shrink-0" />
                    ) : (
                      <ChevronDown size={14} className="text-muted-2 shrink-0" />
                    )}
                    {groupBy === "place" ? (
                      <>
                        <span className="text-sm font-semibold text-foreground">
                          {g.place ?? "장소 미정"}
                        </span>
                        <span
                          className={
                            "text-sm " + (undecidedGroup ? "text-danger" : "text-muted")
                          }
                        >
                          {undecidedGroup ? "시각 미정" : `${g.date} ${g.time ?? ""}`.trim()}
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          className={
                            "text-sm font-semibold " +
                            (undecidedGroup ? "text-danger" : "text-foreground")
                          }
                        >
                          {undecidedGroup ? "시각 미정" : `${g.date} ${g.time ?? ""}`.trim()}
                        </span>
                        <span className="text-sm text-muted">{g.place ?? "장소 미정"}</span>
                      </>
                    )}
                    <Badge variant={undecidedGroup ? "danger" : "primary"} dot={false}>
                      {g.members.length}명
                    </Badge>
                  </button>

                  {!isCollapsed && (
                    <>
                      {/* 장소 안내는 묶음마다 한 번만. 사람마다 반복하면 같은 문장이
                          N번 찍힌다. 관리자만 본다 — 장소를 등록한 것도 총단이다. */}
                      {isAdmin && g.members[0]?.place_note && (
                        <p className="mt-1 text-xs text-muted-2 pl-5">
                          {g.members[0].place_note}
                        </p>
                      )}
                      <ul
                        className={
                          isAdmin
                            ? "mt-1.5 pl-5 space-y-1 text-sm text-muted"
                            : "mt-1.5 pl-5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted"
                        }
                      >
                        {g.members.map((m) => (
                          <li key={m.id} className={isAdmin ? "" : "whitespace-nowrap"}>
                            <span className="text-foreground">{m.person_name}</span>
                            {/* 임역원은 전부 자기 캠퍼스라 캠퍼스 이름이 소음이다.
                                관리자는 그게 차를 짜는 기준이라 반드시 있어야 한다. */}
                            {isAdmin && (
                              <span className="text-muted-2 text-xs ml-1">
                                {m.campus_name}
                                {m.student_id ? ` · ${m.student_id}` : ""}
                              </span>
                            )}
                            <span className="text-muted-2 text-xs ml-1">
                              {/* 지명이 아니라 역할 이름으로 — 픽업 장소도 지명이라
                                  "평창역 → 평창" 처럼 읽히면 오히려 헷갈린다. */}
                              {m.direction === "down" ? "수련회장 출발" : "수련회장 도착"}
                            </span>
                            {isAdmin && (m.attend_from || m.attend_to) && (
                              <span className="text-muted-2 text-xs ml-1">
                                · 참여 {m.attend_from ?? "처음"}~{m.attend_to ?? "끝"}
                              </span>
                            )}
                            {m.note && (
                              <span className="text-muted-2 text-xs ml-1">({m.note})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/** 묶음 키를 DOM id 로 쓸 수 있게 — 날짜·시각·장소에 공백과 `|` 가 들어 있다. */
function cssId(key: string): string {
  return key.replace(/[^a-zA-Z0-9가-힣]/g, "_");
}
