"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PAYMENT_LABELS, PAYMENT_STATUSES } from "@/lib/labels";
import type { AttendanceType, PaymentStatus } from "@/lib/supabase/types";
import {
  setPaymentStatus,
  addRemittance,
  deleteRemittance,
} from "@/lib/campus/payments";

export type PayRow = {
  id: string;
  name: string;
  student_id: string;
  attendance_type: AttendanceType;
  fee: number | null;
  payment_status: PaymentStatus;
};

export type RemittanceRow = {
  id: string;
  amount: number;
  note: string | null;
  created_at: string;
};

const won = (n: number) => n.toLocaleString("ko-KR");

const STATUS_VARIANT: Record<PaymentStatus, "success" | "warning" | "mute"> = {
  paid: "success",
  unpaid: "warning",
  waived: "mute",
};

/** 명단 정렬 순서: 미납 → 완납 → 면제. */
const STATUS_RANK: Record<PaymentStatus, number> = {
  unpaid: 0,
  paid: 1,
  waived: 2,
};

export function CampusPaymentsPanel({
  campusName,
  rows: initial,
  remittances,
}: {
  campusName: string;
  rows: PayRow[];
  remittances: RemittanceRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ amount: "", note: "" });
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  const summary = useMemo(() => {
    let paidCount = 0,
      unpaidCount = 0,
      waivedCount = 0,
      paidTotal = 0,
      unpaidTotal = 0;
    for (const r of rows) {
      const fee = r.fee ?? 0;
      if (r.payment_status === "paid") {
        paidCount++;
        paidTotal += fee;
      } else if (r.payment_status === "unpaid") {
        unpaidCount++;
        unpaidTotal += fee;
      } else waivedCount++;
    }
    return { paidCount, unpaidCount, waivedCount, paidTotal, unpaidTotal };
  }, [rows]);

  // 명단 정렬: 미납 → 완납 → 면제 (그룹 내에서는 등록순 유지 — 안정 정렬).
  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) => STATUS_RANK[a.payment_status] - STATUS_RANK[b.payment_status]
      ),
    [rows]
  );

  // 4 숫자
  const target = summary.paidTotal + summary.unpaidTotal; // 걷어야 할 금액 (면제 제외)
  const collected = summary.paidTotal; // 걷힌 금액
  const outstanding = summary.unpaidTotal; // 미수금
  const remittedSum = useMemo(
    () => remittances.reduce((s, r) => s + r.amount, 0),
    [remittances]
  ); // 총단 송금 누계
  const balance = collected - remittedSum; // 캠퍼스 보유 잔액

  function handleStatus(r: PayRow, status: PaymentStatus) {
    const prev = r.payment_status;
    setRows((rs) =>
      rs.map((x) => (x.id === r.id ? { ...x, payment_status: status } : x))
    );
    startTransition(async () => {
      const res = await setPaymentStatus(r.id, status);
      if (!res.ok) {
        setRows((rs) =>
          rs.map((x) => (x.id === r.id ? { ...x, payment_status: prev } : x))
        );
        setMsg({ type: "err", text: res.message });
      }
    });
  }

  function handleAdd() {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg({ type: "err", text: "0보다 큰 금액을 입력하세요" });
      return;
    }
    startTransition(async () => {
      const res = await addRemittance(amount, draft.note.trim() || null);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setMsg(null);
      setDraft({ amount: "", note: "" });
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    if (!confirm("이 송금 항목을 삭제할까요?")) return;
    startTransition(async () => {
      const res = await deleteRemittance(id);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {campusName} 차량비 정산
        </h2>
        <p className="text-sm text-muted mt-0.5">
          순장/순원 납부 현황 + 총단 송금 내역 관리
        </p>
      </div>

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

      {/* 납부 인원 요약 */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted">완납</p>
          <p className="text-xl font-semibold text-success tabular-nums mt-0.5">
            {summary.paidCount}명
          </p>
          <p className="text-xs text-muted-2 tabular-nums">
            {won(summary.paidTotal)}원
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">미납</p>
          <p className="text-xl font-semibold text-warning tabular-nums mt-0.5">
            {summary.unpaidCount}명
          </p>
          <p className="text-xs text-muted-2 tabular-nums">
            {won(summary.unpaidTotal)}원
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">면제</p>
          <p className="text-xl font-semibold text-muted tabular-nums mt-0.5">
            {summary.waivedCount}명
          </p>
          <p className="text-xs text-muted-2">합계 제외</p>
        </Card>
      </div>

      {/* 순장/순원 납부 현황 */}
      <Card title="순장/순원 납부 현황" subtitle={`${rows.length}명`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
                <th className="px-4 py-2">이름</th>
                <th className="px-4 py-2">학번</th>
                <th className="px-4 py-2 text-right">차량비</th>
                <th className="px-4 py-2">납부</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted-2 py-6">
                    아직 등록된 순장/순원이 없습니다.
                  </td>
                </tr>
              )}
              {sortedRows.map((r) => {
                const waived = r.payment_status === "waived";
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2 text-foreground">{r.name}</td>
                    <td className="px-4 py-2 text-muted-2">{r.student_id}</td>
                    <td
                      className={
                        "px-4 py-2 text-right tabular-nums " +
                        (waived ? "text-muted-2 line-through" : "text-foreground")
                      }
                    >
                      {won(r.fee ?? 0)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <Badge variant={STATUS_VARIANT[r.payment_status]}>
                          {PAYMENT_LABELS[r.payment_status]}
                        </Badge>
                        <select
                          value={r.payment_status}
                          disabled={pending}
                          onChange={(e) =>
                            handleStatus(r, e.target.value as PaymentStatus)
                          }
                          className="text-xs border border-border-2 rounded-md px-1.5 py-0.5 bg-surface"
                        >
                          {PAYMENT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {PAYMENT_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 정산 요약 — 4 숫자 */}
      <Card title="정산 현황" subtitle="걷어야 할 돈 · 걷힌 돈 · 총단 송금 · 캠퍼스 보유">
        <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted">걷어야 할 금액</p>
            <p className="text-lg font-semibold text-foreground tabular-nums mt-0.5">
              {won(target)}원
            </p>
            <p className="text-xs text-muted-2">면제 제외 전원</p>
          </div>
          <div>
            <p className="text-xs text-muted">걷힌 금액</p>
            <p className="text-lg font-semibold text-success tabular-nums mt-0.5">
              {won(collected)}원
            </p>
            <p
              className={
                "text-xs tabular-nums " +
                (outstanding > 0 ? "text-warning" : "text-muted-2")
              }
            >
              미수금 {won(outstanding)}원
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">총단 송금 누계</p>
            <p className="text-lg font-semibold text-primary-800 tabular-nums mt-0.5">
              {won(remittedSum)}원
            </p>
            <p className="text-xs text-muted-2">{remittances.length}건</p>
          </div>
          <div>
            <p className="text-xs text-muted">캠퍼스 보유 잔액</p>
            <p
              className={
                "text-lg font-semibold tabular-nums mt-0.5 " +
                (balance < 0 ? "text-danger" : "text-foreground")
              }
            >
              {won(balance)}원
            </p>
            <p className="text-xs text-muted-2">걷힌 − 송금</p>
          </div>
        </div>
        {target > 0 && collected === target && remittedSum === target && (
          <div className="px-5 pb-4">
            <Badge variant="success">정산 완료 — 전원 납부 · 전액 송금</Badge>
          </div>
        )}
      </Card>

      {/*
        송금 등록 유도 (사용자 피드백: "임역원이 송금 등록을 안 하더라").
        실측으로 운영 `campus_remittances` 가 **0행**이었다 — 기능은 있는데 아무도 안 썼다.
        원인은 "내 일이 끝난 뒤 추가로 하는 일"이라 미뤄지는 것이라, 걷은 돈이 손에
        남아 있는 동안 계속 눈에 띄게 하고, **한 번 눌러 전액 등록**할 수 있게 한다.
      */}
      {balance > 0 && (
        <div className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-warning">
              걷은 돈 중 <b className="tabular-nums">{won(balance)}원</b>이 아직 총단에
              등록되지 않았습니다.
              <span className="block text-xs mt-0.5 text-warning/90">
                실제로 보냈더라도 여기 등록해야 총단 장부와 맞춰집니다 — 나중에 돈 흐름을
                따라갈 때 이 기록이 근거가 됩니다.
              </span>
            </div>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setDraft({ amount: String(balance), note: "" });
                // 금액만 채워주고 저장은 사람이 누르게 둔다 — 실제로 보냈는지는
                // 시스템이 알 수 없다(현금·계좌이체가 섞인다).
                document
                  .getElementById("remit-amount")
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              {won(balance)}원 등록하기
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 총단 송금 추가 */}
        <Card title="총단에게 송금 등록" subtitle="이번에 총단 통장으로 보낸 금액을 추가">
          <div className="p-5 space-y-3">
            <label className="block text-sm">
              <span className="text-muted">보낸 금액</span>
              <input
                id="remit-amount"
                type="number"
                value={draft.amount}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, amount: e.target.value }))
                }
                placeholder="예: 75000"
                className="mt-1 w-full border border-border-2 rounded-lg px-3 py-2 bg-surface text-right tabular-nums"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">메모 (선택)</span>
              <input
                type="text"
                value={draft.note}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, note: e.target.value }))
                }
                placeholder="예: 1차 송금 (보유분 일부 보관)"
                className="mt-1 w-full border border-border-2 rounded-lg px-3 py-2 bg-surface"
              />
            </label>
            <Button onClick={handleAdd} disabled={pending}>
              {pending ? "등록 중…" : "송금 추가"}
            </Button>
            <p className="text-xs text-muted-2">
              걷힌 {won(collected)}원 중 {won(remittedSum)}원 송금 · 보유{" "}
              {won(balance)}원
            </p>
          </div>
        </Card>

        {/* 송금 내역 로그 (누적) */}
        <Card
          title="송금 내역"
          subtitle={`총 ${won(remittedSum)}원 · ${remittances.length}건`}
        >
          <div className="max-h-72 overflow-y-auto divide-y divide-border">
            {remittances.length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-2">
                아직 송금 내역이 없습니다.
              </p>
            )}
            {remittances.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between px-5 py-2.5 gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground tabular-nums">
                    {won(r.amount)}원
                  </p>
                  <p className="text-xs text-muted-2">
                    {new Date(r.created_at).toLocaleString("ko-KR")}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleDelete(r.id)}
                  className="text-muted-2 hover:text-danger shrink-0"
                  aria-label="송금 항목 삭제"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
