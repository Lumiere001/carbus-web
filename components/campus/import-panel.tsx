"use client";

import { useRef, useState } from "react";
import {
  parseRegistrationsCsv,
  type CsvParseResult,
} from "@/lib/csv/parse";
import { insertRegistration } from "@/lib/registrations/mutations";
import {
  tripLabel,
  ATTENDANCE_LABELS,
  deriveAttendance,
} from "@/lib/labels";
import type { EventTrip } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";

type TripMini = Pick<EventTrip, "id" | "key" | "label" | "direction" | "active">;

/**
 * 템플릿 CSV. 상·하행 모두 **편 라벨**로 적는다.
 *
 * 하행 칸은 예전에 O/X 였다. 지금도 O/X 를 받지만(임역원 기존 템플릿 하위호환),
 * O 는 "탄다"만 말하므로 하행 편이 여러 개면 해석할 수 없다 — 그때는 미인식으로
 * 표면화된다. 그래서 템플릿은 처음부터 라벨을 권한다.
 */
function buildTemplate(trips: TripMini[]): string {
  const up = trips.filter((t) => t.direction === "up" && t.active);
  const down = trips.filter((t) => t.direction === "down" && t.active);
  const u0 = up[0]?.label ?? "";
  const u1 = up[1]?.label ?? u0;
  const d0 = down[0]?.label ?? "";
  return [
    "이름,학번,상행 출발,하행 출발,비고",
    `홍길동,26,${u0},${d0},`,
    `김영희,27,${u1},,상행만`,
    `이타지,타지구,,${d0},하행만`,
    "박이동,26,,,KTX 자가 이동",
  ].join("\n");
}

/** 미리보기용 참여형태 라벨 — DB 파생 규칙과 같은 함수를 쓴다. */
function deriveAttendanceLabel(up: number | null, down: number | null): string {
  return ATTENDANCE_LABELS[deriveAttendance(up, down)];
}

export function ImportPanel({
  campusId,
  trips,
}: {
  campusId: string;
  trips: TripMini[];
}) {
  const [preview, setPreview] = useState<CsvParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inserted: number; failed: number } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setDone(null);
    setPreview(parseRegistrationsCsv(content, campusId, trips));
  }

  async function handleRegister() {
    if (!preview || preview.successes.length === 0) return;
    setBusy(true);
    let inserted = 0;
    let failed = 0;
    const remainFailures = [...preview.failures];
    for (const row of preview.successes) {
      const res = await insertRegistration({ ...row, campus_id: campusId });
      if (res.ok) inserted++;
      else {
        failed++;
        remainFailures.push({
          row: 0,
          reason: res.message,
          raw: { 이름: row.name, 학번: row.student_id },
        });
      }
    }
    setBusy(false);
    setDone({ inserted, failed });
    // 성공분은 미리보기에서 비우고 실패분만 남김
    setPreview({ successes: [], failures: remainFailures });
  }

  function downloadTemplate() {
    const blob = new Blob(["﻿" + buildTemplate(trips)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "carbus-순장/순원등록-템플릿.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          CSV 파일 선택
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/tab-separated-values"
          onChange={handleFile}
          className="hidden"
        />
        <Button variant="secondary" onClick={downloadTemplate}>
          템플릿 다운로드
        </Button>
      </div>

      <p className="text-xs text-muted">
        CSV 파일을 선택하면 아래에 등록될 내용 미리보기가 표시됩니다. 템플릿
        형식(이름·학번·참석 유형·상행 출발·하행 차량 이용·비고)에 맞춰 작성해
        주세요.
      </p>
      <p className="text-xs text-muted-2 leading-snug">
        💡 참석 유형 = <b>왕복</b> / <b>편도</b> / <b>버스 미이용</b>(KTX·자차 등 전혀 버스를 안 타는 경우만).
        한쪽만 이용하면 「편도」 + 상행/하행 구분으로 적어주세요. 미이용은 비고에 이동 수단을 적어주세요.
      </p>

      {done && (
        <div className="text-sm rounded-lg px-3 py-2 border bg-success-bg border-success-border text-success">
          등록 완료: {done.inserted}명 성공
          {done.failed > 0 && ` · ${done.failed}명 실패 (아래 확인)`}
        </div>
      )}

      {preview && (
        <div className="space-y-3">
          {preview.notice && (
            <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning">
              {preview.notice}
            </div>
          )}
          <div className="flex gap-4 text-sm">
            <span className="text-success font-medium">
              등록 가능 {preview.successes.length}건
            </span>
            <span className="text-danger font-medium">
              검증 실패 {preview.failures.length}건
            </span>
          </div>

          {preview.successes.length > 0 && (
            <div className="overflow-x-auto bg-surface rounded-xl border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
                    <th className="px-3 py-2">이름</th>
                    <th className="px-3 py-2">학번</th>
                    <th className="px-3 py-2">참석</th>
                    <th className="px-3 py-2">상행 출발</th>
                    <th className="px-3 py-2">하행</th>
                    <th className="px-3 py-2">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.successes.map((r, i) => {
                    // 버스를 전혀 안 타는데 이동 수단을 안 적은 행 — 배차·출석에서 빠지므로 표시한다.
                    const noteMissing =
                      r.up_trip_id === null && r.down_trip_id === null && !r.note?.trim();
                    return (
                    <tr
                      key={i}
                      className={
                        "border-t border-border " +
                        (noteMissing ? "bg-warning-bg/40" : "")
                      }
                    >
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.student_id}</td>
                      <td className="px-3 py-2">
                        {deriveAttendanceLabel(r.up_trip_id, r.down_trip_id)}
                      </td>
                      <td className="px-3 py-2">{tripLabel(r.up_trip_id, trips)}</td>
                      <td className="px-3 py-2">{tripLabel(r.down_trip_id, trips)}</td>
                      <td className="px-3 py-2 text-muted">
                        {r.note ?? ""}
                        {noteMissing && (
                          <span className="ml-1 text-warning text-xs">⚠ 이동 수단</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {preview.failures.length > 0 && (
            <div className="overflow-x-auto bg-danger-bg rounded-xl border border-danger-border">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-danger text-left [&>th]:whitespace-nowrap">
                    <th className="px-3 py-2">행</th>
                    <th className="px-3 py-2">원본</th>
                    <th className="px-3 py-2">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.failures.map((f, i) => (
                    <tr key={i} className="border-t border-danger-border">
                      <td className="px-3 py-2">{f.row || "-"}</td>
                      <td className="px-3 py-2 text-muted">
                        {f.raw.이름 ?? ""} {f.raw.학번 ?? ""}
                      </td>
                      <td className="px-3 py-2 text-danger">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.successes.length > 0 && (
            <Button size="lg" onClick={handleRegister} disabled={busy}>
              {busy ? "등록 중…" : `${preview.successes.length}명 등록`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
