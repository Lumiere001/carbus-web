"use client";

import { Plus, Upload, Clock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { RegistrationExportButton } from "@/components/campus/registration-export-button";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import type { EventTrip } from "@/lib/supabase/types";
import type { summarizeRegistrations } from "@/lib/registrations/view";
import { cn } from "@/lib/utils";
import type { Bus } from "./types";

type Stats = ReturnType<typeof summarizeRegistrations>;
export function RegistrationGridHeader({ campusName, visibleRows, trips, buses, stats, onCreate }: {
  readonly campusName: string; readonly visibleRows: RegistrationRow[]; readonly trips: EventTrip[];
  readonly buses: Bus[]; readonly stats: Stats; readonly onCreate: () => void;
}) {
  return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <nav className="flex items-center gap-1.5 text-xs text-muted-2">
            <span>홈</span>
            <span>›</span>
            <span className="text-muted">순장/순원 관리</span>
          </nav>
          <h2 className="text-2xl font-semibold text-foreground">
            {campusName} 캠퍼스
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>
              참여 <span className="tabular font-medium text-foreground">{stats.total}</span>명
            </span>
            {stats.cancelledCount > 0 && <span>취소 {stats.cancelledCount}명 · 취소 행에서 되돌릴 수 있습니다</span>}
            <span className="text-border-2">·</span>
            <StatDot color="bg-success" label="완납" value={stats.paidCount} />
            <StatDot color="bg-warning" label="미납" value={stats.unpaidCount} />
            <StatDot color="bg-muted" label="면제" value={stats.waivedCount} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RegistrationExportButton rows={visibleRows} trips={trips} buses={buses} campusName={campusName} />
          <a
            href="/campus/import"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Upload className="h-3.5 w-3.5" />
            CSV 등록
          </a>
          <Button
            size="sm"
            type="button"
            onClick={onCreate}
          >
            <Plus className="h-3.5 w-3.5" />
            순장/순원 추가
          </Button>
        </div>
      </div>

  );
}

export function RegistrationGridFilters({ rows, listView, setListView, stats }: {
  readonly rows: RegistrationRow[]; readonly listView: string;
  readonly setListView: (value: string) => void; readonly stats: Stats;
}) { return <>
      <label className="flex flex-wrap items-center gap-3 text-sm text-muted">명단 보기
        <select className="min-h-11 rounded-md border border-border-2 bg-surface px-3 text-foreground" value={listView} onChange={(event) => setListView(event.target.value)}>
          <option value="active">참여 중 {rows.filter((row) => row.participation_status !== "cancelled").length}명</option>
          <option value="cancelled">취소된 신청 {rows.filter((row) => row.participation_status === "cancelled").length}명 · 되돌리기</option>
          <option value="all">전체 {rows.length}명</option>
        </select>
      </label>

      {/* 안내: 미이용 사용법 + 비고 비어있는 미이용 행 알림 (조건부) */}
      <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-2 space-y-1">
        <p>
          상행(가는 편)과 하행(오는 편)을 각각 고릅니다. 한쪽만 이용하면 그 편만 고르고, 버스를 전혀 이용하지 않으면 두 편 모두 <b>이용 안 함</b>으로 둡니다. 참여 기간·수송 요청은 <b>신청 추가</b>와 <b>정보 수정</b>에서 입력합니다.
        </p>
        {stats.selfMissingNote > 0 && (
          <p className="text-warning">
            주의: 미이용 {stats.selfCount}명 중 비고가 비어있는 행 {stats.selfMissingNote}건 — 정보 수정에서 이동수단을 확인해 주세요.
          </p>
        )}
      </div>

      <p className="text-sm text-muted">표는 좌우로 밀어 볼 수 있습니다. 이름과 정보 수정 버튼은 양 끝에 고정되어 있습니다.</p>

  </>;
}

export function RegistrationGridSummary({ stats }: { readonly stats: Stats }) { return (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface-2/60 px-4 py-2.5 text-xs text-muted">
          <span>
            예상 수입{" "}
            <span className="tabular font-medium text-foreground">
              ₩{stats.expected.toLocaleString()}
            </span>
          </span>
          <span>
            수령{" "}
            <span className="tabular font-medium text-success">
              ₩{stats.received.toLocaleString()}
            </span>
          </span>
          <span>
            잔액{" "}
            <span className="tabular font-medium text-warning">
              ₩{stats.outstanding.toLocaleString()}
            </span>
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-muted-2">
            <Clock className="h-3 w-3" />
            텍스트는 입력을 마치면 저장 · 선택 항목은 바로 저장
          </span>
        </div>
  );
}

/** 통계 dot + 라벨 + tabular 숫자. */
function StatDot({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {label}
      <span className="tabular font-medium text-foreground">{value}</span>
    </span>
  );
}

