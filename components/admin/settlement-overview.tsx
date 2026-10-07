import { Card } from "@/components/ui/card";
import { ComparisonBars } from "@/components/ui/comparison-bars";

export function SettlementOverview({ paid, remitted, received }: {
  readonly paid: number; readonly remitted: number; readonly received: number;
}) {
  const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  const comparisons = [
    { label: "개인 완납 기록", value: paid, display: won(paid) },
    { label: "캠퍼스 송금 기록", value: remitted, display: won(remitted) },
    { label: "총단 입금 확인", value: received, display: won(received) },
  ];
  return <Card title="정산 금액 비교" subtitle="서로 다른 세 가지 기록 · 완료율이 아닌 금액 비교">
    <div className="space-y-5 p-4 sm:p-5">
      <ComparisonBars rows={comparisons} unit="원" />
      <dl className="grid gap-3 sm:grid-cols-2">
        {[{ label: "개인 기록 − 캠퍼스 송금", value: paid - remitted }, { label: "캠퍼스 송금 − 총단 확인", value: remitted - received }].map((gap) => <div key={gap.label} className="rounded-lg bg-surface-2 p-3">
          <dt className="text-xs text-muted">{gap.label}</dt>
          <dd className={`mt-1 font-mono text-base tabular-nums ${gap.value === 0 ? "text-success" : "text-warning"}`}>{won(gap.value)}{gap.value === 0 && <span className="ml-2 font-sans text-sm">일치</span>}</dd>
        </div>)}
      </dl>
    </div>
  </Card>;
}
