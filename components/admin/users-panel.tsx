"use client";

import { useState } from "react";
import {
  type ProfileRow,
  assignCampusAdmin,
  revokeToGuest,
  changeCampus,
} from "@/lib/admin/profiles";
import { Button } from "@/components/ui/button";

type Campus = { id: string; name: string };

export function UsersPanel({
  profiles: initial,
  campuses,
}: {
  profiles: ProfileRow[];
  campuses: Campus[];
}) {
  const [profiles, setProfiles] = useState<ProfileRow[]>(initial);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const [pick, setPick] = useState<Record<string, string>>({});

  const campusName = (id: string | null) =>
    id ? (campuses.find((c) => c.id === id)?.name ?? "—") : "—";

  function replace(row: ProfileRow) {
    setProfiles((prev) => prev.map((p) => (p.id === row.id ? row : p)));
  }

  // 시스템 계정(운영자 viewer/master)은 provider_id 없음 → 권한 관리 대상에서 제외
  const managed = profiles.filter(
    (p) => p.role === "guest" || p.role === "campus_admin"
  );
  const guests = managed.filter((p) => p.role === "guest");
  const admins = managed.filter((p) => p.role === "campus_admin");

  async function handleAssign(p: ProfileRow) {
    const campusId = pick[p.id];
    if (!campusId) {
      setMsg({ type: "err", text: "캠퍼스를 선택하세요" });
      return;
    }
    const res = await assignCampusAdmin(p.id, campusId);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
    setMsg({
      type: "ok",
      text: `${p.display_name ?? "사용자"} → ${campusName(campusId)} 임역원 부여`,
    });
  }

  async function handleRevoke(p: ProfileRow) {
    if (!confirm(`${p.display_name ?? "사용자"}의 임역원 권한을 해제할까요?`))
      return;
    const res = await revokeToGuest(p.id);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
    setMsg({ type: "ok", text: "권한 해제됨 (게스트로 복귀)" });
  }

  async function handleChange(p: ProfileRow, campusId: string) {
    const res = await changeCampus(p.id, campusId);
    if (!res.ok) return setMsg({ type: "err", text: res.message });
    replace(res.row);
    setMsg({ type: "ok", text: `${campusName(campusId)}(으)로 변경` });
  }

  return (
    <div className="space-y-5">
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

      {/* 게스트 (권한 미부여) */}
      <section>
        <h3 className="text-sm font-medium text-muted mb-2">
          승인 대기 (게스트) — {guests.length}명
        </h3>
        <div className="overflow-x-auto bg-surface rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">가입</th>
                <th className="px-3 py-2">캠퍼스 부여</th>
                <th className="px-3 py-2">액션</th>
              </tr>
            </thead>
            <tbody>
              {guests.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted-2 py-6">
                    승인 대기 중인 게스트가 없습니다.
                  </td>
                </tr>
              )}
              {guests.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">{p.display_name ?? "(이름 없음)"}</td>
                  <td className="px-3 py-2 text-muted-2">
                    {p.created_at?.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={pick[p.id] ?? ""}
                      onChange={(e) =>
                        setPick((s) => ({ ...s, [p.id]: e.target.value }))
                      }
                      className="border border-border-2 rounded-md px-2 py-1 bg-surface"
                    >
                      <option value="">선택</option>
                      {campuses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <Button size="sm" onClick={() => handleAssign(p)}>
                      임역원 부여
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 임역원 */}
      <section>
        <h3 className="text-sm font-medium text-muted mb-2">
          임역원 — {admins.length}명
        </h3>
        <div className="overflow-x-auto bg-surface rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">담당 캠퍼스</th>
                <th className="px-3 py-2">액션</th>
              </tr>
            </thead>
            <tbody>
              {admins.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-muted-2 py-6">
                    아직 임역원이 없습니다.
                  </td>
                </tr>
              )}
              {admins.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">{p.display_name ?? "(이름 없음)"}</td>
                  <td className="px-3 py-2">
                    <select
                      value={p.campus_id ?? ""}
                      onChange={(e) => handleChange(p, e.target.value)}
                      className="border border-border-2 rounded-md px-2 py-1 bg-surface"
                    >
                      {campuses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleRevoke(p)}
                    >
                      권한 해제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
