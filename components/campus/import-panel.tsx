"use client";

import { useRef, useState } from "react";
import { parseRegistrationsCsv, type CsvParseResult } from "@/lib/csv/parse";
import { insertRegistration } from "@/lib/registrations/mutations";
import { Button } from "@/components/ui/button";
import { ImportPreview } from "./import/import-preview";
import { buildImportTemplate, type ImportTrip, type ImportUnit } from "./import/template";

export function ImportPanel({ campusId, trips, units = [] }: {
  readonly campusId: string;
  readonly trips: readonly ImportTrip[];
  readonly units?: readonly ImportUnit[];
}) {
  const [preview, setPreview] = useState<CsvParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState<{ inserted: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (busy || reading) return;
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    try {
      const content = await file.text();
      setDone(null);
      setPreview(parseRegistrationsCsv(content, campusId, [...trips], units));
    } finally {
      setReading(false);
    }
  }

  async function handleRegister() {
    if (busy || reading || !preview || preview.successes.length === 0) return;
    setBusy(true);
    let inserted = 0;
    let failed = 0;
    const remainFailures = [...preview.failures];
    for (const row of preview.successes) {
      const result = await insertRegistration({ ...row, campus_id: campusId });
      if (result.ok) inserted++;
      else {
        failed++;
        remainFailures.push({
          row: 0,
          reason: result.message,
          raw: { 이름: row.name, 학번: row.student_id },
        });
      }
    }
    setBusy(false);
    setDone({ inserted, failed });
    setPreview({ successes: [], failures: remainFailures });
  }

  function downloadTemplate() {
    const blob = new Blob(["\uFEFF" + buildImportTemplate(trips)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "carbus-순장/순원등록-템플릿.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={preview?.successes.length ? "secondary" : "default"}
          disabled={busy || reading}
          onClick={() => fileRef.current?.click()}
        >CSV 파일 선택</Button>
        <input
          disabled={busy || reading}
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/tab-separated-values"
          onChange={handleFile}
          className="hidden"
        />
        <Button variant="secondary" onClick={downloadTemplate}>템플릿 다운로드</Button>
      </div>
      <div className="space-y-2 text-xs leading-snug text-muted">
        <p>CSV를 선택하면 등록할 내용을 미리 볼 수 있습니다. 템플릿의 이름·학번·방향별 운행편과 이동수단·참여 일정을 작성해 주세요.</p>
        <p>버스를 쓰는 방향에는 운행편 이름을, 나머지 방향에는 이동수단을 적습니다. 이동수단은 ‘우리 버스’, ‘타지구 차량’, ‘KTX·고속버스’, ‘자차·가족차’, ‘기타’ 중 해당 값을 사용합니다. 비고는 참고 메모입니다.</p>
        <p>참여 시작일·종료일을 비우면 행사 전체 참석입니다. 부분 참석은 두 날짜를 적고, 부분 참석·편도·별도 이동수단은 참여 시작·종료 일시를 모두 확정해야 등록됩니다. 일시는 한국 날짜와 시각을 함께 적습니다<span className="whitespace-nowrap">(YYYY-MM-DDTHH:mm)</span>.</p>
        <p>타지구 차량은 등록된 지구 이름과 이동상태(대기·확정)를 방향별로 적습니다. 수송 요청·수강신청은 명단 등록의 필수 정보가 아닙니다.</p>
        <p className="text-muted-2">템플릿 예시 행은 행사 전체 참석·우리 버스 왕복 기준이며, 왕복 운행편이 없으면 입력 틀만 받습니다. 실제 확정된 일정을 적고, 모르는 시각을 임의의 00:00으로 채우지 마세요.</p>
      </div>
      {done && (
        <div
          role={done.failed > 0 ? "alert" : "status"}
          className={"rounded-lg border px-3 py-2 text-sm " + (done.failed > 0 ? "border-warning-border bg-warning-bg text-warning" : "border-success-border bg-success-bg text-success")}
        >
          등록 결과: {done.inserted}명 성공
          {done.failed > 0 && ` · ${done.failed}명 실패 (아래 확인)`}
        </div>
      )}
      {preview && <ImportPreview preview={preview} trips={trips} units={units} />}
      {!!preview?.successes.length && (
        <Button size="lg" onClick={handleRegister} disabled={busy || reading}>
          {busy ? "등록 중…" : `${preview.successes.length}명 등록`}
        </Button>
      )}
    </div>
  );
}
