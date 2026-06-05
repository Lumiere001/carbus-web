import {
  Users,
  Bus,
  CircleCheck,
  Wallet,
  TriangleAlert,
  Activity,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BusOccupancy, type BusOcc } from "@/components/admin/bus-occupancy";
import { CapacityCard } from "@/components/admin/capacity-card";

export const dynamic = "force-dynamic";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** 채워진 비율 막대. tone 으로 임계 색 전환. */
function ProgressBar({
  value,
  max,
  tone = "primary",
}: {
  value: number;
  max: number;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = {
    primary: "bg-primary-600",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary-50 text-primary-800 p-2">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted">{label}</p>
          <p className="text-2xl font-semibold text-foreground tabular-nums leading-tight mt-0.5">
            {value}
          </p>
          {sub && <p className="text-xs text-muted-2 mt-0.5">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

function since24hIso(): string {
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "기록 없음";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const since = since24hIso();

  const [campusRes, dayRes, busRes, payRes, threeWayRes, cfgRes, auditRes, slotRes, downCountRes] =
    await Promise.all([
      supabase
        .from("v_campus_stats")
        .select("*")
        .order("total", { ascending: false }),
      supabase.from("v_day_capacity").select("*").order("display_order"),
      supabase.from("v_bus_occupancy").select("*").order("bus_id"),
      supabase.from("v_payment_summary").select("*"),
      supabase.from("v_payment_3way_comparison").select("*"),
      supabase.from("system_config").select("*").maybeSingle(),
      supabase
        .from("registration_audit")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      supabase.from("departure_slots").select("id, label").order("display_order"),
      supabase
        .from("registrations")
        .select("id", { count: "exact", head: true })
        .eq("uses_return_bus", true),
    ]);

  const campuses = campusRes.data ?? [];
  const days = dayRes.data ?? [];
  const buses = busRes.data ?? [];
  const slots = slotRes.data ?? [];
  const payment = payRes.data ?? [];
  const threeWay = threeWayRes.data ?? [];
  const cfg = cfgRes.data;
  const audit24h = auditRes.count ?? 0;
  // 하행: 슬롯 없는 단일 풀 — 전 호차 정원 합 vs 하행 이용 신청 인원.
  const downPassengers = downCountRes.count ?? 0;
  const downCapacity = buses.reduce((s, b) => s + (b.capacity ?? 0), 0);

  // ── KPI 집계 ────────────────────────────────────────────
  const totalPeople = campuses.reduce((s, c) => s + (c.total ?? 0), 0);
  const arrivedTotal = campuses.reduce((s, c) => s + (c.arrived_count ?? 0), 0);
  const returnTarget = campuses.reduce((s, c) => s + (c.return_target ?? 0), 0);
  const returnedTotal = campuses.reduce((s, c) => s + (c.returned_count ?? 0), 0);
  const dayCapacity = days.reduce((s, d) => s + (d.total_capacity ?? 0), 0);
  const dayPassengers = days.reduce((s, d) => s + (d.total_passengers ?? 0), 0);
  const paidCount = payment.reduce((s, p) => s + (p.paid_count ?? 0), 0);
  const unpaidCount = payment.reduce((s, p) => s + (p.unpaid_count ?? 0), 0);
  const waivedCount = payment.reduce((s, p) => s + (p.waived_count ?? 0), 0);
  const paidTotal = payment.reduce((s, p) => s + (p.paid_total ?? 0), 0);
  const unpaidTotal = payment.reduce((s, p) => s + (p.unpaid_total ?? 0), 0);
  const billable = paidCount + unpaidCount;
  const paidRate = billable > 0 ? Math.round((paidCount / billable) * 100) : 0;

  // ── 통장 대조 집계 ──────────────────────────────────────
  const sysTotal = threeWay.reduce((s, r) => s + (r.system_paid_total ?? 0), 0);
  const campusRemitted = threeWay.reduce(
    (s, r) => s + (r.campus_remitted_total ?? 0),
    0
  );
  const masterReceived = threeWay.reduce(
    (s, r) => s + (r.master_received_total ?? 0),
    0
  );
  const maxCampus = Math.max(1, ...campuses.map((c) => c.total ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          운영자 대시보드
        </h2>
        <p className="text-sm text-muted mt-0.5">
          전체 신청·정원·호차·정산 현황 한눈에 보기
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          icon={<Users size={18} />}
          label="총 신청 인원"
          value={totalPeople.toLocaleString("ko-KR")}
          sub={`${campuses.length}개 캠퍼스`}
        />
        <Kpi
          icon={<Bus size={18} />}
          label="상행 좌석"
          value={`${dayPassengers} / ${dayCapacity}`}
          sub={`잔여 ${Math.max(0, dayCapacity - dayPassengers)}석`}
        />
        <Kpi
          icon={<CircleCheck size={18} />}
          label="완납률"
          value={`${paidRate}%`}
          sub={`완납 ${paidCount} · 미납 ${unpaidCount}`}
        />
        <Kpi
          icon={<Wallet size={18} />}
          label="입금 차이"
          value={won(sysTotal - masterReceived)}
          sub={`시스템 ${won(sysTotal)} 대비`}
        />
      </div>

      {/* 출석 현황 — 도착·귀가 진행률 (master·viewer 공통) */}
      <Card title="출석 현황" subtitle="현장 도착 · 귀가 진행률">
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-baseline justify-between text-sm mb-1.5">
              <span className="text-muted">도착 (전원)</span>
              <span className="tabular-nums font-medium text-foreground">
                {totalPeople > 0 ? (
                  <>
                    {arrivedTotal} / {totalPeople}{" "}
                    <span className="text-muted-2 font-normal">
                      ({Math.round((arrivedTotal / totalPeople) * 100)}%)
                    </span>
                  </>
                ) : (
                  <span className="text-muted-2 font-normal">대상 없음</span>
                )}
              </span>
            </div>
            <ProgressBar value={arrivedTotal} max={totalPeople} tone="success" />
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm mb-1.5">
              <span className="text-muted">귀가 (하행 대상)</span>
              <span className="tabular-nums font-medium text-foreground">
                {returnTarget > 0 ? (
                  <>
                    {returnedTotal} / {returnTarget}{" "}
                    <span className="text-muted-2 font-normal">
                      ({Math.round((returnedTotal / returnTarget) * 100)}%)
                    </span>
                  </>
                ) : (
                  <span className="text-muted-2 font-normal">대상 없음</span>
                )}
              </span>
            </div>
            <ProgressBar value={returnedTotal} max={returnTarget} tone="primary" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* B. 출발 정원 — 상행(슬롯별)/하행(전 호차) 토글 */}
        <CapacityCard
          upRows={days}
          downCapacity={downCapacity}
          downPassengers={downPassengers}
        />

        {/* D. 차량비 요약 */}
        <Card title="차량비 정산 요약" subtitle="납부 상태별 인원·금액">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="success">완납 {paidCount}명</Badge>
              <span className="text-sm tabular-nums text-foreground">
                {won(paidTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <Badge variant="warning">미납 {unpaidCount}명</Badge>
              <span className="text-sm tabular-nums text-foreground">
                {won(unpaidTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <Badge variant="mute">면제 {waivedCount}명</Badge>
              <span className="text-sm tabular-nums text-muted-2">제외</span>
            </div>
            <div className="pt-3 mt-1 border-t border-border flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                징수 대상 합계
              </span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {won(paidTotal + unpaidTotal)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* C. 호차별 — 상행·하행 (토글) */}
      <BusOccupancy buses={buses as BusOcc[]} slots={slots} />

      {/* A. 캠퍼스별 인원 */}
      <Card title="캠퍼스별 신청 인원" subtitle="왕복·편도 구분">
        <div className="p-5 space-y-2.5">
          {campuses.length === 0 && (
            <p className="text-sm text-muted">아직 신청 데이터가 없습니다.</p>
          )}
          {campuses.map((c) => (
            <div key={c.campus_id} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-sm text-foreground truncate">
                {c.campus_name}
              </span>
              <div className="flex-1">
                <ProgressBar value={c.total ?? 0} max={maxCampus} />
              </div>
              <span className="w-44 shrink-0 text-right text-xs tabular-nums text-muted">
                왕복 {c.roundtrip_count ?? 0} · 편도 {c.oneway_count ?? 0}
                {(c.self_count ?? 0) > 0 && (
                  <span className="ml-1 text-warning">· 미이용 {c.self_count}</span>
                )}
                <span className="ml-1.5 font-medium text-foreground">
                  계 {c.total ?? 0}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* E. 통장 대조 요약 */}
        <Card title="통장 대조" subtitle="시스템 · 캠퍼스 송금 · 총단 입금">
          <div className="p-5 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">시스템 합계</span>
              <span className="tabular-nums text-foreground">{won(sysTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">캠퍼스 송금</span>
              <span className="tabular-nums text-foreground">
                {won(campusRemitted)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">총단 입금</span>
              <span className="tabular-nums text-foreground">
                {won(masterReceived)}
              </span>
            </div>
            <div className="pt-3 mt-1 border-t border-border flex items-center justify-between">
              <span className="font-medium text-foreground">
                시스템 − 총단
              </span>
              {sysTotal - masterReceived === 0 ? (
                <Badge variant="success">일치</Badge>
              ) : (
                <Badge variant="danger">
                  <TriangleAlert size={12} />
                  {won(sysTotal - masterReceived)}
                </Badge>
              )}
            </div>
          </div>
        </Card>

        {/* F. 헬스 */}
        <Card title="시스템 헬스" subtitle="배차·활동·연결 상태">
          <div className="p-5 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">현재 Phase</span>
              <Badge variant={cfg?.current_phase === "phase2" ? "primary" : "mute"}>
                {cfg?.current_phase === "phase2" ? "배차/마감" : "입력"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">마지막 배차</span>
              <span className="text-foreground">{timeAgo(cfg?.last_batch_at ?? null)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">최근 24h 변경</span>
              <span className="tabular-nums text-foreground">{audit24h}건</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">DB 연결</span>
              <Badge variant={campusRes.error ? "danger" : "success"}>
                <Activity size={12} />
                {campusRes.error ? "오류" : "정상"}
              </Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
