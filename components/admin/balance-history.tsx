import type { BalanceHistory } from "@/lib/payments/balance-history";

const attendance: Readonly<Record<string, string>> = { roundtrip: "왕복", oneway: "편도", self: "버스 미이용" };
const ledgerKind: Readonly<Record<string, string>> = { payment: "수납", refund: "환불", adjust: "조정" };
function timestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시각 확인 필요";
  return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function BalanceHistoryDetails({ history, href }: { readonly history: BalanceHistory | undefined; readonly href: string }) {
  const fare = history?.fareChange;
  const ledger = history?.ledger;
  return <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs text-muted">
    <div className="space-y-1">
      <p>{fare ? <>편성·청구 변경 기록 <time dateTime={fare.created_at} className="inline-block tabular-nums">{timestamp(fare.created_at)} KST</time>
        {fare.before_type !== fare.after_type && <span className="ml-2 inline-block">{attendance[fare.before_type ?? ""] ?? "미상"} → {attendance[fare.after_type ?? ""] ?? "미상"}</span>}
      </> : "편성·청구 변경 시각: 기록 없음"}</p>
      {ledger && <p>{ledger.source === "migration" ? "이관된 장부 기록" : "장부 일자"} <time dateTime={ledger.occurred_at} className="inline-block tabular-nums">{timestamp(ledger.occurred_at)} KST</time> · {ledgerKind[ledger.kind] ?? ledger.kind} {ledger.amount.toLocaleString("ko-KR")}원{ledger.source === "migration" && <span className="ml-1 inline-block">(실제 거래일 확인 필요)</span>}</p>}
    </div>
    <a href={href} className="inline-flex min-h-11 items-center whitespace-nowrap underline underline-offset-4">활동 기록 보기</a>
  </div>;
}
