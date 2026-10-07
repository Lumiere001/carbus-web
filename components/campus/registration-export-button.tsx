"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrationCsv, type ExportRegistration } from "@/lib/csv/export";

export function RegistrationExportButton({ rows, trips, buses, campusName }: {
  readonly rows: readonly ExportRegistration[];
  readonly trips: readonly { readonly id: number; readonly label: string }[];
  readonly buses: readonly { readonly id: number; readonly name: string }[];
  readonly campusName: string;
}) {
  const [downloadedCount, setDownloadedCount] = useState<number | null>(null);

  function download() {
    const csv = registrationCsv({ rows, trips, buses });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `carbus-${campusName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}-명단.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadedCount(rows.length);
  }

  return (
    <div>
      <Button variant="secondary" size="sm" type="button" disabled={rows.length === 0} onClick={download}>
        <Download className="h-3.5 w-3.5" /> CSV 내보내기
      </Button>
      {downloadedCount !== null && <p role="status" className="mt-1 text-xs text-muted">{downloadedCount}건의 파일을 준비했습니다. 브라우저 다운로드를 확인하세요.</p>}
    </div>
  );
}
