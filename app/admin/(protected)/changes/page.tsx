import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TriangleAlert } from "lucide-react";
import type { Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * 마감 후 변동 모니터 (master·viewer).
 * 마지막 배차 이후 임역원/운영자가 **내용을 바꾼** 신청을 모아 보여주고,
 * 각자 상·하행 배차가 제대로 됐는지(미배정·요일 불일치) 점검한다.
 * 배차 실행이 만든 배정 컬럼만의 변경은 제외(노이즈 제거).
 */

const CONTENT_FIELDS = [
  "name",
  "student_id",
  "attendance_type",
  "departure_day",
  "uses_return_bus",
  "payment_status",
  "roles",
  "campus_id",
  "note",
] as const;

const FIELD_LABEL: Record<string, string> = {
  name: "이름",
  student_id: "학번",
  attendance_type: "참석유형",
  departure_day: "출발요일",
  uses_return_bus: "하행이용",
  payment_status: "납부",
  roles: "역할",
  campus_id: "캠퍼스",
  note: "비고",
};

const ROLE_LABEL: Record<string, string> = {
  master: "총단 운영자",
  viewer: "운영자(보기)",
  campus_admin: "임역원",
  guest: "게스트",
};

function asObj(j: Json | null): Record<string, Json> | null {
  return j && typeof j === "object" && !Array.isArray(j)
    ? (j as Record<string, Json>)
    : null;
}

/** 내용(배정 외) 필드 중 바뀐 것들. */
function contentDiff(before: Json | null, after: Json | null): string[] {
  const b = asObj(before);
  const a = asObj(after);
  const out: string[] = [];
  for (const f of CONTENT_FIELDS) {
    if (JSON.stringify(b?.[f] ?? null) !== JSON.stringify(a?.[f] ?? null))
      out.push(f);
  }
  return out;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Entry = {
  regId: string;
  kind: "신규" | "수정" | "제외";
  fields: Set<string>;
  at: string;
  by: string | null;
  name: string;
  campusId: string | null;
};

export default async function AdminChangesPage() {
  const supabase = await createClient();

  const { data: cfg } = await supabase
    .from("system_config")
    .select("phase2_started_at, last_batch_at, current_phase")
    .maybeSingle();
  // 현재 마감 단계인가로 판단(과거에 이미 phase2였어도 인식).
  const isPhase2 = cfg?.current_phase === "phase2";
  // 기준점: 마감 전환 시각 → 없으면(컬럼 추가 전부터 phase2였던 경우) 마지막 배차 시각으로 대체.
  const cutoff = cfg?.phase2_started_at ?? cfg?.last_batch_at ?? null;

  // 마감 단계면 audit 조회. cutoff 있으면 그 이후만, 없으면 전체(내용 변경만 추림).
  const auditRes = isPhase2
    ? await (cutoff
        ? supabase
            .from("registration_audit")
            .select(
              "id, registration_id, created_at, change_type, before_value, after_value, changed_by"
            )
            .gt("created_at", cutoff)
            .order("created_at", { ascending: false })
            .limit(500)
        : supabase
            .from("registration_audit")
            .select(
              "id, registration_id, created_at, change_type, before_value, after_value, changed_by"
            )
            .order("created_at", { ascending: false })
            .limit(500))
    : { data: [] };
  const audit = auditRes.data ?? [];

  // 신청별 변동 요약 (내용 변경 또는 추가/제외만 — 배정 컬럼만의 변경은 제외)
  const byReg = new Map<string, Entry>();
  for (const a of audit) {
    const diff =
      a.change_type === "update"
        ? contentDiff(a.before_value, a.after_value)
        : [];
    if (a.change_type === "update" && diff.length === 0) continue; // 배정 전용 변경 → 노이즈
    const obj = asObj(a.after_value) ?? asObj(a.before_value);
    const prev = byReg.get(a.registration_id);
    const e: Entry =
      prev ??
      ({
        regId: a.registration_id,
        kind: "수정",
        fields: new Set<string>(),
        at: a.created_at, // audit desc → 최초 진입이 최신
        by: a.changed_by,
        name: (obj?.name as string) ?? "—",
        campusId: (obj?.campus_id as string) ?? null,
      } as Entry);
    if (a.change_type === "delete") e.kind = "제외";
    else if (a.change_type === "insert" && e.kind !== "제외") e.kind = "신규";
    for (const f of diff) e.fields.add(f);
    byReg.set(a.registration_id, e);
  }

  const entries = [...byReg.values()].sort((x, y) =>
    x.at < y.at ? 1 : x.at > y.at ? -1 : 0
  );

  // 현재 상태(배차 점검) — 제외 외
  const liveIds = entries.filter((e) => e.kind !== "제외").map((e) => e.regId);
  const regMap = new Map<
    string,
    {
      departure_day: string | null;
      uses_return_bus: boolean;
      assigned_up_bus_id: number | null;
      assigned_down_bus_id: number | null;
    }
  >();
  if (liveIds.length > 0) {
    const { data: regs } = await supabase
      .from("registrations")
      .select(
        "id, departure_day, uses_return_bus, assigned_up_bus_id, assigned_down_bus_id"
      )
      .in("id", liveIds);
    for (const r of regs ?? []) regMap.set(r.id, r);
  }

  const [busRes, campusRes] = await Promise.all([
    supabase.from("buses").select("id, name, departure_day"),
    supabase.from("campuses").select("id, name"),
  ]);
  const busMap = new Map((busRes.data ?? []).map((b) => [b.id, b]));
  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));

  const changerIds = [
    ...new Set(entries.map((e) => e.by).filter(Boolean)),
  ] as string[];
  const changerName = new Map<string, string>();
  if (changerIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, role")
      .in("id", changerIds);
    for (const p of profs ?? [])
      changerName.set(
        p.id,
        p.display_name?.trim() ? p.display_name : ROLE_LABEL[p.role] ?? "—"
      );
  }

  // 행 가공 + 배차 상태
  const rows = entries.map((e) => {
    const cur = regMap.get(e.regId);
    let up = "—";
    let down = "—";
    let rebatch = false;
    if (e.kind !== "제외" && cur) {
      if (cur.departure_day != null) {
        if (cur.assigned_up_bus_id == null) {
          up = "미배정";
          rebatch = true;
        } else {
          const b = busMap.get(cur.assigned_up_bus_id);
          const match = b?.departure_day === cur.departure_day;
          up = (b?.name ?? `${cur.assigned_up_bus_id}호차`) + (match ? "" : " ⚠요일불일치");
          if (!match) rebatch = true;
        }
      }
      if (cur.uses_return_bus === true) {
        if (cur.assigned_down_bus_id == null) {
          down = "미배정";
          rebatch = true;
        } else {
          down = busMap.get(cur.assigned_down_bus_id)?.name ?? `${cur.assigned_down_bus_id}호차`;
        }
      }
    }
    return {
      ...e,
      campus: e.campusId ? campusName.get(e.campusId) ?? "—" : "—",
      changer: e.by ? changerName.get(e.by) ?? "—" : "시스템",
      up,
      down,
      rebatch,
    };
  });

  const rebatchCount = rows.filter((r) => r.rebatch).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">마감 후 변동</h2>
        <p className="text-sm text-muted mt-0.5">
          마감(입력 마감 단계 전환) 이후 추가·수정·제외된 순장/순원과, 그들의 배차 상태를 모아 봅니다.
        </p>
      </div>

      {!isPhase2 && (
        <Card className="p-5">
          <p className="text-sm text-muted">
            아직 <b>마감 단계(phase2)</b>가 아닙니다. Phase 화면에서 마감으로
            전환하면, 그 이후의 변동이 여기에 모입니다.
          </p>
        </Card>
      )}

      {isPhase2 && (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-muted">
              마감 시각{" "}
              <b className="text-foreground">{cutoff ? fmt(cutoff) : "기록 없음"}</b>
            </span>
            <span className="text-muted">
              변동 인원 <b className="text-foreground tabular-nums">{rows.length}</b>
            </span>
            <span className={rebatchCount > 0 ? "text-warning" : "text-muted-2"}>
              재배차 필요 <b className="tabular-nums">{rebatchCount}</b>
            </span>
          </div>

          {rebatchCount > 0 && (
            <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning flex items-start gap-2">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                마감 후 변동으로 <b>{rebatchCount}명</b>이 미배정이거나 요일이 맞지 않습니다.
                배차 화면에서 다시 실행하면 정리됩니다.
              </span>
            </div>
          )}

          <Card title="변동 인원" subtitle="마감 이후 · 최신순">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-muted text-left">
                    <th className="px-4 py-2.5">시각</th>
                    <th className="px-4 py-2.5">유형</th>
                    <th className="px-4 py-2.5">대상</th>
                    <th className="px-4 py-2.5">바뀐 항목</th>
                    <th className="px-4 py-2.5">상행</th>
                    <th className="px-4 py-2.5">하행</th>
                    <th className="px-4 py-2.5">변경자</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted-2 py-6">
                        마감 후 변동이 없습니다. ✓
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr
                      key={r.regId}
                      className={
                        "border-t border-border " +
                        (r.rebatch ? "bg-warning-bg/40" : "")
                      }
                    >
                      <td className="px-4 py-2 text-muted-2 whitespace-nowrap">
                        {fmt(r.at)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={
                            r.kind === "신규"
                              ? "success"
                              : r.kind === "제외"
                                ? "danger"
                                : "primary"
                          }
                        >
                          {r.kind}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-foreground whitespace-nowrap">
                        {r.name}
                        <span className="ml-1.5 text-xs text-muted-2">{r.campus}</span>
                      </td>
                      <td className="px-4 py-2 text-muted-2">
                        {r.kind === "수정"
                          ? [...r.fields].map((f) => FIELD_LABEL[f] ?? f).join(", ") || "—"
                          : "—"}
                      </td>
                      <td className={"px-4 py-2 " + (r.up.includes("미배정") || r.up.includes("⚠") ? "text-warning font-medium" : "text-foreground")}>
                        {r.up}
                      </td>
                      <td className={"px-4 py-2 " + (r.down.includes("미배정") ? "text-warning font-medium" : "text-foreground")}>
                        {r.down}
                      </td>
                      <td className="px-4 py-2 text-muted">{r.changer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
