import { ATTENDANCE_LABELS, deriveAttendance, tripLabel } from "@/lib/labels";
import { toKstInput } from "@/lib/time/kst";
import { TRANSPORT_LABELS } from "@/lib/transport/labels";
import type { CsvParseResult, ParsedRow } from "@/lib/csv/parse";
import type { ImportTrip, ImportUnit } from "./template";

function DirectionTransport({ row, direction, units }: {
  readonly row: ParsedRow;
  readonly direction: "up" | "down";
  readonly units: ReadonlyMap<string, string>;
}) {
  const leg = row.legs.find((candidate) => candidate.direction === direction);
  const tripId = direction === "up" ? row.up_trip_id : row.down_trip_id;
  if (!leg) return <>{tripId !== null ? TRANSPORT_LABELS.our_bus : "이동수단 확인 필요"}</>;
  return (
    <div className="space-y-0.5">
      <p>{TRANSPORT_LABELS[leg.mode]}</p>
      {leg.via_unit_id && <p className="text-xs text-muted">{units.get(leg.via_unit_id) ?? leg.via_unit_id}</p>}
      <p className="text-xs text-muted-2">{leg.status === "pending" ? "대기" : "확정"}</p>
    </div>
  );
}

function PlannedAttendance({ row }: { readonly row: ParsedRow }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">
        {row.attend_from || row.attend_to
          ? `부분 참석 ${row.attend_from ?? "확인 필요"} ~ ${row.attend_to ?? "확인 필요"}`
          : "행사 전체 참석"}
      </p>
      {(row.attend_from_at || row.attend_to_at) && (
        <dl className="space-y-1 tabular-nums">
          <div><dt className="inline text-xs text-muted-2">시작 </dt><dd className="inline">{toKstInput(row.attend_from_at).replace("T", " ") || "확인 필요"}</dd></div>
          <div><dt className="inline text-xs text-muted-2">종료 </dt><dd className="inline">{toKstInput(row.attend_to_at).replace("T", " ") || "확인 필요"}</dd></div>
        </dl>
      )}
    </div>
  );
}

export function ImportPreview({ preview, trips, units }: {
  readonly preview: CsvParseResult;
  readonly trips: readonly ImportTrip[];
  readonly units: readonly ImportUnit[];
}) {
  const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
  const tripList = [...trips];
  return (
    <div className="space-y-3">
      {preview.notice && (
        <div role="status" className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
          {preview.notice}
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="font-medium text-success">등록 가능 {preview.successes.length}건</span>
        <span className="font-medium text-danger">검증 실패 {preview.failures.length}건</span>
      </div>
      {preview.successes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[64rem] text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-muted [&>th]:whitespace-nowrap">
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">학번</th>
                <th className="px-3 py-2">버스 이용</th>
                <th className="px-3 py-2">참여 예정 (KST)</th>
                <th className="px-3 py-2">상행 출발</th>
                <th className="px-3 py-2">상행 이동수단</th>
                <th className="px-3 py-2">하행 출발</th>
                <th className="px-3 py-2">하행 이동수단</th>
                <th className="px-3 py-2">비고</th>
              </tr>
            </thead>
            <tbody>
              {preview.successes.map((row, index) => (
                <tr key={index} className="border-t border-border align-top">
                  <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.name}</td>
                  <td className="px-3 py-2">{row.student_id}</td>
                  <td className="px-3 py-2">{ATTENDANCE_LABELS[deriveAttendance(row.up_trip_id, row.down_trip_id)]}</td>
                  <td className="min-w-52 px-3 py-2"><PlannedAttendance row={row} /></td>
                  <td className="px-3 py-2">{tripLabel(row.up_trip_id, tripList)}</td>
                  <td className="px-3 py-2"><DirectionTransport row={row} direction="up" units={unitNames} /></td>
                  <td className="px-3 py-2">{tripLabel(row.down_trip_id, tripList)}</td>
                  <td className="px-3 py-2"><DirectionTransport row={row} direction="down" units={unitNames} /></td>
                  <td className="min-w-40 px-3 py-2 text-muted [overflow-wrap:anywhere]">{row.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview.failures.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-danger-border bg-danger-bg">
          <p role="alert" className="px-3 py-2 text-sm text-danger">
            CSV 검증에 실패한 {preview.failures.length}개 행이 있습니다. 아래 사유를 확인해주세요.
          </p>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-danger [&>th]:whitespace-nowrap">
                <th className="px-3 py-2">행</th>
                <th className="px-3 py-2">원본</th>
                <th className="px-3 py-2">사유</th>
              </tr>
            </thead>
            <tbody>
              {preview.failures.map((failure, index) => (
                <tr key={index} className="border-t border-danger-border">
                  <td className="px-3 py-2">{failure.row || "-"}</td>
                  <td className="px-3 py-2 text-muted">{failure.raw.이름 ?? ""} {failure.raw.학번 ?? ""}</td>
                  <td className="px-3 py-2 text-danger">{failure.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
