"use client";

import { useRef, useState } from "react";
import {
  parseRegistrationsCsv,
  type CsvParseResult,
} from "@/lib/csv/parse";
import { insertRegistration } from "@/lib/registrations/mutations";
import { ATTENDANCE_LABELS, dayLabel } from "@/lib/labels";
import { Button } from "@/components/ui/button";

const TEMPLATE_CSV = [
  "이름,학번,참석 유형,상행 요일,하행 차량 이용,비고",
  "홍길동,26,왕복,화요일,O,",
  "김영희,27,편도,수요일,X,상행만",
  "박간사,간사,편도,,O,하행만",
].join("\n");

export function ImportPanel({ campusId }: { campusId: string }) {
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
    setPreview(parseRegistrationsCsv(content, campusId));
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
    const blob = new Blob(["﻿" + TEMPLATE_CSV], {
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
        형식(이름·학번·참석 유형·상행 요일·하행 차량 이용·비고)에 맞춰 작성해
        주세요.
      </p>

      {done && (
        <div className="text-sm rounded-lg px-3 py-2 border bg-success-bg border-success-border text-success">
          등록 완료: {done.inserted}명 성공
          {done.failed > 0 && ` · ${done.failed}명 실패 (아래 확인)`}
        </div>
      )}

      {preview && (
        <div className="space-y-3">
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-muted text-left">
                    <th className="px-3 py-2">이름</th>
                    <th className="px-3 py-2">학번</th>
                    <th className="px-3 py-2">참석</th>
                    <th className="px-3 py-2">상행 요일</th>
                    <th className="px-3 py-2">하행</th>
                    <th className="px-3 py-2">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.successes.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.student_id}</td>
                      <td className="px-3 py-2">
                        {ATTENDANCE_LABELS[r.attendance_type]}
                      </td>
                      <td className="px-3 py-2">{dayLabel(r.departure_day)}</td>
                      <td className="px-3 py-2">{r.uses_return_bus ? "O" : "X"}</td>
                      <td className="px-3 py-2 text-muted">{r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.failures.length > 0 && (
            <div className="overflow-x-auto bg-danger-bg rounded-xl border border-danger-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-danger text-left">
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
