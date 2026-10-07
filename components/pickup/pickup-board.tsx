import { Card } from "@/components/ui/card";
import { TriangleAlert } from "lucide-react";
import { PickupTimeBoard } from "./pickup-time-board";

export type BoardRow = {
  id: number | null;
  direction: string | null;
  pickup_at: string | null;
  pickup_date: string | null;
  pickup_time: string | null;
  place: string | null;
  note: string | null;
  person_name: string | null;
  campus_name: string | null;
  /** 아래 넷은 **관리자 화면에서만** 쓴다. 임역원은 안 넘긴다. */
  student_id?: string | null;
  place_note?: string | null;
  attend_from?: string | null;
  attend_to?: string | null;
};

/**
 * 누가 보는 화면인가. **데이터 범위가 아니라 표시 항목을 가른다** —
 * 범위는 각 페이지의 쿼리(그리고 RLS)가 정한다.
 *
 * - `campus` 임역원: 전부 자기 캠퍼스 사람이라 **캠퍼스 이름이 매 줄 반복되면
 *   소음**이다. 뺀다. 필요한 건 누가·어디로·언제·비고뿐이다.
 * - `admin` 총단: 캠퍼스가 **핵심 정보**다(어느 캠퍼스에서 몇 명 나오는지로 차를
 *   짠다). 학번·장소 안내·참여기간까지 등록된 것을 다 보여준다.
 */
export type Audience = "admin" | "campus";

export function PickupBoard({ rows, audience, title = "수송 요청 보드", emptyHint }: {
  readonly rows: readonly BoardRow[];
  readonly audience: Audience;
  readonly title?: string;
  readonly emptyHint?: string;
}) {
  const undecided = rows.filter((row) => !row.pickup_date || !row.pickup_time).length;
  return <Card title={title} subtitle={`${rows.length}건 · 날짜별 시간표`}>
    {rows.length === 0 ? <p className="px-5 py-6 text-sm text-muted-2">{emptyHint ?? "아직 수송 요청이 없습니다. 사람의 정보 수정에서 수송 요청을 추가하면 여기에 날짜·시각별로 모입니다."}</p> : <>
      {undecided > 0 && <div className="flex items-start gap-2 border-b border-border bg-danger-bg/40 px-5 py-3 text-sm text-danger">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span><b>{undecided}건</b>이 시각 미정입니다. <span className="inline-block">수송 예정 시각을 확인해 주세요.</span></span>
      </div>}
      <PickupTimeBoard rows={rows} audience={audience} />
    </>}
  </Card>;
}
