"use client";

import { useState } from "react";
import {
  type ProfileRow,
  assignCampusAdmin,
  revokeToGuest,
  revokeAccess,
  restoreAccess,
  changeCampus,
  assignDriverBus,
  clearDriverBus,
} from "@/lib/admin/profiles";

type Campus = { id: string; name: string };
type BusOpt = { id: number; name: string };

const selectClass =
  "border border-border-2 rounded-md px-2 py-1 bg-surface min-w-[7rem]";

export function UsersPanel({
  profiles: initial,
  campuses,
  buses,
}: {
  profiles: ProfileRow[];
  campuses: Campus[];
  buses: BusOpt[];
}) {
  const [profiles, setProfiles] = useState<ProfileRow[]>(initial);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  const campusName = (id: string | null) =>
    id ? (campuses.find((c) => c.id === id)?.name ?? "—") : "—";
  const busName = (id: number | null) =>
    id != null ? (buses.find((b) => b.id === id)?.name ?? `${id}호차`) : "—";

  function replace(row: ProfileRow) {
    setProfiles((prev) => prev.map((p) => (p.id === row.id ? row : p)));
  }
  const nameOf = (p: ProfileRow) => p.display_name ?? "(이름 없음)";

  // 시스템 계정(운영자 viewer/master)은 권한 관리 대상에서 제외.
  // 미배정(게스트·차량 둘 다 없음) → 위로 정렬해 승인 대기 노출.
  // 내린 계정은 목록에서 갈라 낸다 — 기수가 바뀔 때마다 쌓여서, 다음 임역원을
  // 찾는 데 방해가 된다. 기록은 그대로 남는다(§21 참고).
  const revoked = profiles
    .filter((p) => p.revoked_at != null)
    .sort((a, b) => (b.revoked_at ?? "").localeCompare(a.revoked_at ?? ""));

  const managed = profiles
    .filter(
      (p) => p.revoked_at == null && (p.role === "guest" || p.role === "campus_admin")
    )
    .sort((a, b) => {
      const an = a.role === "guest" && a.driver_bus_id == null ? 0 : 1;
      const bn = b.role === "guest" && b.driver_bus_id == null ? 0 : 1;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });

  /** 접근 내리기 — 임역원 기간이 끝난 사람. 지우는 게 아니라 못 들어오게 한다. */
  async function onRevoke(p: ProfileRow) {
    if (
      !confirm(
        `${nameOf(p)} 의 접근을 내릴까요?\n\n` +
          `· 로그인해도 아무 화면에 못 들어갑니다 (권한·배정이 모두 해제됩니다)\n` +
          `· 이 사람이 남긴 기록(감사 로그·배차·장부)은 그대로 남습니다\n` +
          `· 필요하면 아래 "내린 계정" 에서 되돌릴 수 있습니다`
      )
    )
      return;
    const res = await revokeAccess(p.id);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
    setMsg({ type: "ok", text: `${nameOf(p)} 접근 내림` });
  }

  async function onRestore(p: ProfileRow) {
    const res = await restoreAccess(p.id);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
    setMsg({
      type: "ok",
      text: `${nameOf(p)} 되돌림 — 캠퍼스·호차는 다시 지정해 주세요`,
    });
  }

  // 캠퍼스(임역원) 지정·변경·해제 — 차량 배정과 독립.
  async function onCampusChange(p: ProfileRow, value: string) {
    if (value === "") {
      if (p.role !== "campus_admin") return;
      if (!confirm(`${nameOf(p)}의 임역원(캠퍼스) 배정을 해제할까요? (차량 배정은 유지)`))
        return;
      const res = await revokeToGuest(p.id);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      replace(res.row);
      return setMsg({ type: "ok", text: `${nameOf(p)} 임역원 해제` });
    }
    const res =
      p.role === "campus_admin"
        ? await changeCampus(p.id, value)
        : await assignCampusAdmin(p.id, value);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
    setMsg({
      type: "ok",
      text: `${nameOf(p)} → ${campusName(value)} 임역원`,
    });
  }

  // 차량(호차) 지정·해제 — 캠퍼스와 독립. 게스트도 바로 차량 순장 가능.
  async function onBusChange(p: ProfileRow, value: string) {
    if (value === "") {
      if (p.driver_bus_id == null) return;
      if (!confirm(`${nameOf(p)}의 차량 순장(호차) 배정을 해제할까요?`)) return;
      const res = await clearDriverBus(p.id);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      replace(res.row);
      return setMsg({ type: "ok", text: `${nameOf(p)} 차량 순장 해제` });
    }
    const res = await assignDriverBus(p.id, Number(value));
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
    setMsg({
      type: "ok",
      text: `${nameOf(p)} → ${busName(Number(value))} 차량 순장`,
    });
  }

  const adminCount = managed.filter((p) => p.role === "campus_admin").length;
  const driverCount = managed.filter((p) => p.driver_bus_id != null).length;
  const pendingCount = managed.filter(
    (p) => p.role === "guest" && p.driver_bus_id == null
  ).length;

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={
            "text-sm rounded-lg px-3 py-2 border " +
            (msg.type === "err"
              ? "bg-danger-bg border-danger-border text-danger"
              : "bg-success-bg border-success-border text-success")
          }
        >
          {msg.text}
        </div>
      )}

      <p className="text-xs text-muted-2">
        캠퍼스(임역원)와 차량(호차)은 <b>각각 따로</b> 지정합니다. 차량만 배정하면
        그 사람은 본인 호차 출석체크 화면만 보고 캠퍼스 정보는 보지 못합니다. 둘 다
        배정도 가능합니다. 비우면(— 없음 —) 해당 배정만 해제됩니다.
      </p>
      <p className="text-xs text-muted-2">
        승인 대기 {pendingCount}명 · 임역원 {adminCount}명 · 차량 순장 {driverCount}명
      </p>

      <div className="overflow-x-auto bg-surface rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
              <th className="px-3 py-2">이름</th>
              <th className="px-3 py-2">가입</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">캠퍼스 (임역원)</th>
              <th className="px-3 py-2">차량 (호차)</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {managed.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted-2 py-6">
                  로그인한 사용자가 없습니다.
                </td>
              </tr>
            )}
            {managed.map((p) => {
              const isAdmin = p.role === "campus_admin";
              const isDriver = p.driver_bus_id != null;
              return (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{nameOf(p)}</td>
                  <td className="px-3 py-2 text-muted-2 whitespace-nowrap">
                    {p.created_at?.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap space-x-1">
                    {isAdmin && (
                      <span className="inline-block rounded-md bg-info-bg text-info text-xs px-1.5 py-0.5">
                        임역원
                      </span>
                    )}
                    {isDriver && (
                      <span className="inline-block rounded-md bg-success-bg text-success text-xs px-1.5 py-0.5">
                        차량순장
                      </span>
                    )}
                    {!isAdmin && !isDriver && (
                      <span className="inline-block rounded-md bg-surface-2 text-muted-2 text-xs px-1.5 py-0.5">
                        대기
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.campus_id ?? ""}
                      onChange={(e) => onCampusChange(p, e.target.value)}
                      className={selectClass}
                    >
                      <option value="">— 없음 —</option>
                      {campuses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.driver_bus_id != null ? String(p.driver_bus_id) : ""}
                      onChange={(e) => onBusChange(p, e.target.value)}
                      className={selectClass}
                    >
                      <option value="">— 없음 —</option>
                      {buses.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onRevoke(p)}
                      className="text-xs text-muted-2 hover:text-danger"
                    >
                      접근 내리기
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 내린 계정 — 지운 게 아니라 못 들어오게 한 사람들. 기록은 남아 있다. */}
      {revoked.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-2/40">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">
              내린 계정 {revoked.length}명
            </h3>
            <p className="text-xs text-muted-2 mt-0.5">
              로그인해도 아무 화면에 못 들어갑니다. 이들이 남긴 기록은 그대로 남아
              있어서 <b>지우지 않고 내려 둡니다</b> — 지우면 “누가 바꿨는지”가 사라집니다.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {revoked.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm text-muted">
                  {nameOf(p)}
                  <span className="text-xs text-muted-2 ml-2">
                    {p.revoked_at?.slice(0, 10)} 내림
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRestore(p)}
                  className="text-xs text-primary hover:underline"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
