import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, X } from "lucide-react";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * 로그 — 순장/순원 변경 이력 · 배차 실행 이력.
 *
 * 예전엔 최근 50건만 보여줬다. 사용자 피드백: "이전 이력들을 다 볼 수 없다.
 * 여러 번 바꾼 사람의 이력이 추적이 안 된다."
 *
 * 그런데 제한만 푸는 것으로는 부족했다 — 실측 18,967건 중 **16,857건(89%)이
 * 값이 하나도 안 바뀐 UPDATE** 다(배차를 돌리면 599명을 전부 UPDATE 하니까).
 * 그래서 `v_registration_changes` 뷰가 "무엇이 바뀌었는지"를 계산하고,
 * 이 화면은 기본적으로 실제 변경만 보여준다. 그 위에 검색·유형 필터·페이지
 * 넘김·**한 사람 이력만 보기**를 얹었다.
 */

type ChangeType = Database["public"]["Enums"]["request_type"];

const CHANGE_LABEL: Record<ChangeType, string> = {
  insert: "추가",
  update: "수정",
  delete: "제외",
};
const CHANGE_VARIANT: Record<ChangeType, "success" | "primary" | "danger"> = {
  insert: "success",
  update: "primary",
  delete: "danger",
};
const ROLE_LABEL: Record<string, string> = {
  master: "총단 운영자",
  viewer: "운영자(보기)",
  campus_admin: "임역원",
  guest: "게스트",
};

const PAGE_SIZE = 100;

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Params = {
  q?: string;
  type?: string;
  page?: string;
  person?: string;
  /** "1" 이면 값이 안 바뀐 UPDATE 도 보여준다. */
  noop?: string;
};

/** 현재 필터를 유지한 채 일부만 바꾼 링크 (페이지는 기본으로 1로 되돌린다). */
function href(cur: Params, patch: Partial<Params>): string {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...cur, page: undefined, ...patch }))
    if (v) next[k] = String(v);
  const qs = new URLSearchParams(next).toString();
  return qs ? `/admin/logs?${qs}` : "/admin/logs";
}

export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const q = (params.q ?? "").trim();
  // URL 로 아무 문자열이나 올 수 있다 — 아는 값만 통과시킨다.
  const raw = (params.type ?? "").trim();
  const typeFilter: ChangeType | "" =
    raw === "insert" || raw === "update" || raw === "delete" ? raw : "";
  const personId = (params.person ?? "").trim();
  const showNoop = params.noop === "1";

  let query = supabase
    .from("v_registration_changes")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  // 값이 안 바뀐 UPDATE 는 기본적으로 감춘다 (추가·제외는 항상 보인다).
  if (!showNoop) query = query.or("change_type.neq.update,changed_fields.not.is.null");
  if (personId) query = query.eq("registration_id", personId);
  if (typeFilter) query = query.eq("change_type", typeFilter);
  if (q) query = query.or(`person_name.ilike.%${q}%,student_id.ilike.%${q}%`);

  const from = (page - 1) * PAGE_SIZE;
  const [auditRes, runsRes, campusRes] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    supabase
      .from("batch_runs")
      .select("id, run_at, success, total_assigned, empty_seats, elapsed_ms, trigger_reason")
      .order("run_at", { ascending: false })
      .limit(20),
    supabase.from("campuses").select("id, name"),
  ]);

  const audit = auditRes.data ?? [];
  const total = auditRes.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const runs = runsRes.data ?? [];
  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));

  const changerIds = [
    ...new Set(audit.map((a) => a.changed_by).filter(Boolean)),
  ] as string[];
  const nameById = new Map<string, string>();
  if (changerIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, role")
      .in("id", changerIds);
    for (const p of profs ?? [])
      nameById.set(
        p.id,
        p.display_name?.trim() ? p.display_name : ROLE_LABEL[p.role] ?? "—"
      );
  }

  // 한 사람만 보고 있을 때 헤더에 이름을 띄운다.
  const personName = personId ? audit[0]?.person_name ?? null : null;

  const chip = (active: boolean) =>
    "px-3 py-1 rounded-lg text-sm border transition " +
    (active
      ? "bg-primary-50 border-primary-200 text-primary-800 font-medium"
      : "border-border text-muted hover:bg-surface-2");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">로그</h2>
        <p className="text-sm text-muted mt-0.5">
          순장/순원 변경 이력 · 배차 실행 이력
        </p>
      </div>

      {personId && (
        <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2 border bg-primary-50 border-primary-200 text-primary-800">
          <span>
            <b>{personName ?? "이 사람"}</b> 의 이력만 보고 있습니다 ({total}건)
          </span>
          <Link href={href(params, { person: undefined })} className="ml-auto underline">
            <X size={14} className="inline" /> 전체 보기
          </Link>
        </div>
      )}

      <Card
        title="순장/순원 변경 이력"
        subtitle={
          showNoop
            ? `전체 ${total.toLocaleString()}건 (값이 안 바뀐 수정 포함)`
            : `실제로 바뀐 것 ${total.toLocaleString()}건`
        }
      >
        {/* 검색·필터 */}
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <form method="GET" className="relative">
            {personId && <input type="hidden" name="person" value={personId} />}
            {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
            {showNoop && <input type="hidden" name="noop" value="1" />}
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2"
            />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="이름·학번 검색"
              className="w-52 pl-8 pr-3 py-1.5 text-sm border border-border-2 rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </form>

          <div className="flex gap-1.5">
            <Link href={href(params, { type: undefined })} className={chip(!typeFilter)}>
              전체
            </Link>
            {(["insert", "update", "delete"] as const).map((t) => (
              <Link key={t} href={href(params, { type: t })} className={chip(typeFilter === t)}>
                {CHANGE_LABEL[t]}
              </Link>
            ))}
          </div>

          <Link
            href={href(params, { noop: showNoop ? undefined : "1" })}
            className={chip(showNoop) + " ml-auto"}
            title="배차를 돌리면 값이 안 바뀐 수정 이력이 대량으로 쌓입니다. 기본은 숨김입니다."
          >
            값 안 바뀐 수정도 보기
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">시각</th>
                <th className="px-4 py-2.5">유형</th>
                <th className="px-4 py-2.5">대상</th>
                <th className="px-4 py-2.5">바뀐 항목</th>
                <th className="px-4 py-2.5">변경자</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted-2 py-6">
                    {q || typeFilter || personId
                      ? "조건에 맞는 이력이 없습니다."
                      : "변경 이력이 없습니다."}
                  </td>
                </tr>
              )}
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-2 whitespace-nowrap">
                    {a.created_at ? fmt(a.created_at) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {a.change_type && (
                      <Badge variant={CHANGE_VARIANT[a.change_type]}>
                        {CHANGE_LABEL[a.change_type]}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-foreground">
                    {/* 이름을 누르면 그 사람 이력만 — "여러 번 바꾼 사람" 추적용 */}
                    <Link
                      href={href(params, { person: a.registration_id ?? undefined, q: undefined })}
                      className="hover:underline"
                    >
                      {a.person_name ?? "—"}
                    </Link>
                    <span className="text-xs text-muted-2 ml-1.5">
                      {a.campus_id ? campusName.get(a.campus_id) ?? "—" : "—"}
                      {a.student_id ? ` · ${a.student_id}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {a.change_type !== "update"
                      ? "—"
                      : a.changed_fields?.length
                        ? a.changed_fields.join(", ")
                        : <span className="text-muted-2">값 변화 없음</span>}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {a.changed_by ? nameById.get(a.changed_by) ?? "—" : "시스템"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이지 넘김 */}
        {lastPage > 1 && (
          <div className="px-5 py-3 border-t border-border flex items-center gap-2 text-sm">
            <span className="text-muted-2">
              {page} / {lastPage} 쪽 · {total.toLocaleString()}건
            </span>
            <span className="ml-auto flex gap-1.5">
              {page > 1 && (
                <>
                  <Link href={href(params, { page: "1" })} className={chip(false)}>
                    처음
                  </Link>
                  <Link href={href(params, { page: String(page - 1) })} className={chip(false)}>
                    이전
                  </Link>
                </>
              )}
              {page < lastPage && (
                <>
                  <Link href={href(params, { page: String(page + 1) })} className={chip(false)}>
                    다음
                  </Link>
                  <Link href={href(params, { page: String(lastPage) })} className={chip(false)}>
                    마지막
                  </Link>
                </>
              )}
            </span>
          </div>
        )}
      </Card>

      <Card title="배차 실행 이력" subtitle="최근 20회">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">시각</th>
                <th className="px-4 py-2.5">결과</th>
                <th className="px-4 py-2.5">배정</th>
                <th className="px-4 py-2.5">소요</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted-2 py-6">
                    배차 실행 이력이 없습니다.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-2 whitespace-nowrap">{fmt(r.run_at)}</td>
                  <td className="px-4 py-2">
                    <Badge variant={r.success ? "success" : "danger"}>
                      {r.success ? "성공" : "실패"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.total_assigned ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-2">
                    {r.elapsed_ms != null ? `${r.elapsed_ms}ms` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
