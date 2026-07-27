"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setMasterReceived, masterRemitFor } from "@/lib/admin/payments";

export type ThreeWayRow = {
  campus_id: string | null;
  campus_name: string | null;
  system_paid_total: number | null;
  campus_remitted_total: number | null;
  master_received_total: number | null;
  diff_system_vs_campus: number | null;
  diff_campus_vs_master: number | null;
  diff_system_vs_master: number | null;
  /** 걷어야 할 금액 (완납+미납, 면제 제외). page에서 v_payment_summary 병합. */
  target?: number;
  /** 미납 인원. 0이면 "다 걷힘". */
  unpaid_count?: number;
  paid_count?: number;
};

export type WaivedRow = {
  id: string;
  name: string;
  campus_name: string;
  note: string | null;
};

/** 낸 돈이 청구액보다 많은 사람 (장부 계산). 확정 채무가 아니라 확인 대상. */
export type BalanceRow = {
  registration_id: string;
  name: string;
  campus_name: string;
  /** 납부 시점에 얼어붙은 청구액 (Phase 2-A). 편성을 바꿔도 안 움직인다. */
  charged_now: number;
  /** **지금 참여 형태로 다시 계산한** 요금. 위와 다르면 그 차이가 돌려줄 돈이다. */
  fee_now: number;
  paid_total: number;
  balance: number;
  /** 지금 기준 돌려줘야 할 돈 (3-D). */
  refund_due: number;
  /** 'fee_dropped' = 낸 뒤 편성이 바뀜 · 'overpaid' = 청구보다 많이 받음 */
  refund_reason: string | null;
  note: string | null;
};

const won = (n: number) => n.toLocaleString("ko-KR");

/** 차이 셀: 0이면 중립, 아니면 절댓값 기준 색상 강조. */
function DiffCell({ value }: { value: number }) {
  if (value === 0)
    return <span className="text-muted-2 tabular-nums">0</span>;
  const tone =
    Math.abs(value) >= 50000 ? "text-danger" : "text-warning";
  return (
    <span className={`tabular-nums font-medium ${tone}`}>
      {value > 0 ? "+" : ""}
      {won(value)}
    </span>
  );
}

export function PaymentsPanel({
  rows,
  isMaster,
  waived,
  balances,
}: {
  rows: ThreeWayRow[];
  isMaster: boolean;
  waived: WaivedRow[];
  balances: BalanceRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ total: string; note: string }>({
    total: "",
    note: "",
  });
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  const sum = (key: keyof ThreeWayRow) =>
    rows.reduce((s, r) => s + ((r[key] as number) ?? 0), 0);

  function startEdit(r: ThreeWayRow) {
    setEditing(r.campus_id);
    setDraft({ total: String(r.master_received_total ?? 0), note: "" });
    setMsg(null);
  }

  /** 캠퍼스가 안 올린 송금분을 총단이 대신 등록. */
  function remitFor(r: ThreeWayRow) {
    const gap = r.diff_system_vs_campus ?? 0;
    // 뷰가 나오는 값이라 campus_id 가 이론상 null 일 수 있다 — 그 행은 대상이 아니다.
    if (gap <= 0 || !r.campus_id) return;
    const campusId = r.campus_id;
    if (
      !confirm(
        `${r.campus_name}가 아직 등록하지 않은 ${won(gap)}을 총단이 대신 등록합니다.\n` +
          `실제로 돈이 들어온 것이 맞는지 통장에서 확인하셨나요?`
      )
    )
      return;
    startTransition(async () => {
      const res = await masterRemitFor(campusId, gap);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setMsg({ type: "ok", text: `${r.campus_name} 송금 ${won(gap)} 대리 등록 완료` });
      router.refresh();
    });
  }

  function save(r: ThreeWayRow) {
    const total = Number(draft.total);
    if (!Number.isFinite(total) || total < 0) {
      setMsg({ type: "err", text: "0 이상 숫자를 입력하세요" });
      return;
    }
    startTransition(async () => {
      const res = await setMasterReceived(
        r.campus_id!,
        total,
        draft.note.trim() || null
      );
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setEditing(null);
      setMsg({ type: "ok", text: `${r.campus_name} 입금액 ${won(total)}원 등록` });
      router.refresh();
    });
  }

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

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
                <th className="px-4 py-2.5">캠퍼스</th>
                <th className="px-4 py-2.5 text-right">걷어야 할</th>
                <th className="px-4 py-2.5 text-right">걷힌(완납)</th>
                <th className="px-4 py-2.5 text-right">캠퍼스 송금</th>
                <th className="px-4 py-2.5 text-right">총단 입금</th>
                <th className="px-4 py-2.5 text-right">차이①<span className="text-muted-2 font-normal"> 시스템−캠퍼스</span></th>
                <th className="px-4 py-2.5 text-right">차이②<span className="text-muted-2 font-normal"> 캠퍼스−총단</span></th>
                {isMaster && <th className="px-4 py-2.5"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.campus_id} className="border-t border-border">
                  <td className="px-4 py-2.5 text-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {r.campus_name}
                      {(r.target ?? 0) > 0 && (r.unpaid_count ?? 0) === 0 && (
                        <Badge variant="success" dot={false}>완납</Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {won(r.target ?? 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {won(r.system_paid_total ?? 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {won(r.campus_remitted_total ?? 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {editing === r.campus_id ? (
                      <input
                        type="number"
                        value={draft.total}
                        autoFocus
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, total: e.target.value }))
                        }
                        className="w-28 text-right border border-border-2 rounded-md px-2 py-1 bg-surface"
                      />
                    ) : (
                      won(r.master_received_total ?? 0)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <DiffCell value={r.diff_system_vs_campus ?? 0} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <DiffCell value={r.diff_campus_vs_master ?? 0} />
                  </td>
                  {isMaster && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {editing === r.campus_id ? (
                        <span className="flex gap-1 justify-end">
                          <Button size="sm" disabled={pending} onClick={() => save(r)}>
                            저장
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => setEditing(null)}
                          >
                            취소
                          </Button>
                        </span>
                      ) : (
                        <span className="flex gap-1 justify-end">
                          {/*
                            캠퍼스가 송금 등록을 안 한 만큼(시스템 완납 − 캠퍼스 송금)을
                            총단이 한 번에 대신 채운다. 실측 0행이던 기록을 살리는 장치다.
                          */}
                          {(r.diff_system_vs_campus ?? 0) > 0 && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              title={`캠퍼스가 아직 등록하지 않은 ${won(
                                r.diff_system_vs_campus ?? 0
                              )}을 총단이 대신 등록합니다`}
                              onClick={() => remitFor(r)}
                            >
                              송금 대신 등록
                            </Button>
                          )}
                          <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>
                            입금 등록
                          </Button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-2 font-semibold bg-surface-2">
                <td className="px-4 py-2.5">합계</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                  {won(sum("target"))}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {won(sum("system_paid_total"))}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {won(sum("campus_remitted_total"))}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {won(sum("master_received_total"))}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <DiffCell value={sum("diff_system_vs_campus")} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <DiffCell value={sum("diff_campus_vs_master")} />
                </td>
                {isMaster && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted-2">
        차이 0이면 정상. 노랑(±5만 미만)·빨강(±5만 이상)은 점검 필요.
      </p>

      {/* 낸 돈 > 청구액 — 장부 계산 결과 (master 전용) */}
      {isMaster && balances.length > 0 && (
        <Card
          title="차액 확인 필요"
          subtitle={`${balances.length}명 · 합계 ${won(
            balances.reduce((s, b) => s + b.refund_due, 0)
          )}원 — 낸 금액이 지금 청구액보다 많습니다`}
        >
          <div className="px-5 pt-4 text-xs text-muted leading-relaxed">
            왕복으로 내고 나서 하행을 타지구 차량으로 바꾸거나 참석을 취소한 경우입니다.
            <b className="text-foreground"> 현장에서 이미 돌려드렸을 수 있으니</b> 확인이
            필요합니다. 비고에 환불이라고 적어두지 않은 분도 포함돼 있습니다.
            <br />
            <b className="text-foreground">편성 변경</b> 표시는 <b>납부 후에 편을 비우거나
            줄인</b> 경우입니다 — 예전에는 이런 사람이 이 목록에 아예 안 떠서, 돌려줄 돈이
            있는 줄도 몰랐습니다.
          </div>
          <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-border">
            {balances.map((b) => (
              <div key={b.registration_id} className="px-5 py-2.5">
                <div className="flex items-center gap-2">
                  <Badge variant="mute" dot={false}>
                    {b.campus_name}
                  </Badge>
                  <span className="text-sm text-foreground">{b.name}</span>
                  {b.refund_reason === "fee_dropped" && (
                    <Badge variant="warning" dot={false}>편성 변경</Badge>
                  )}
                  <span className="ml-auto text-sm font-medium text-warning tabular-nums">
                    +{won(b.refund_due)}원
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-2">
                  <span className="tabular-nums">
                    낸 돈 {won(b.paid_total)}원 · 지금 청구 {won(b.fee_now)}원
                    {b.charged_now !== b.fee_now && (
                      <> (납부 당시 {won(b.charged_now)}원)</>
                    )}
                  </span>
                  {b.note && (
                    <span className="truncate max-w-full">· {b.note}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 면제자 통합 명단 (master 전용) */}
      {isMaster && (
        <Card
          title="면제자 명단"
          subtitle={`전체 ${waived.length}명 — 차량비 합계에서 제외됨`}
        >
          {waived.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-2">
              면제 처리된 인원이 없습니다.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-border">
              {waived.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-2 px-5 py-2.5"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="mute" dot={false}>
                      {w.campus_name}
                    </Badge>
                    <span className="text-sm text-foreground">{w.name}</span>
                  </span>
                  {w.note && (
                    <span className="text-xs text-muted-2 truncate max-w-[50%]">
                      {w.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
