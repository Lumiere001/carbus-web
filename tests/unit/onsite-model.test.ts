import { describe, expect, it } from "vitest";
import { mergeOnsite, onsiteSnapshotSchema } from "@/lib/onsite/model";

const reg = "f3000000-0000-4000-8000-000000000001";
const visitId = "f3000000-0000-4000-8000-000000000002";
function state(revision: number) {
  return onsiteSnapshotSchema.parse([{ registration_id: reg, revision, visits: [{
    id: visitId, visit_number: 1, version: revision,
    arrived_at: "2026-10-07T03:30:00+00:00", departed_at: null,
  }] }]);
}
describe("현장 기록 응답 순서", () => {
  it("늦은 저장 응답이 더 최신의 다른 기기 기록을 덮어쓰지 않는다", () => {
    // Given a newer Realtime snapshot
    const current = state(3);
    // When an old response arrives
    const merged = mergeOnsite(current, state(2));
    // Then the confirmed current revision survives
    expect(merged).toEqual(current);
  });
  it("한 사람의 갱신이 다른 사람의 기록을 지우지 않는다", () => {
    // Given two confirmed registration records
    const another = onsiteSnapshotSchema.parse([{ registration_id: "f3000000-0000-4000-8000-000000000003", revision: 0, visits: [] }]);
    // When only the first person's revision changes
    const merged = mergeOnsite([...state(1), ...another], state(2));
    // Then both records remain, with only the first updated
    expect(merged).toEqual([...state(2), ...another]);
  });
  it("시간대가 빠진 서버 시각을 화면의 실제 기록으로 받아들이지 않는다", () => {
    // Given ambiguous date-time input
    const input = [{ registration_id: reg, revision: 1, visits: [{ id: visitId, visit_number: 1, version: 1, arrived_at: "2026-10-07T12:30:00", departed_at: null }] }];
    // When crossing the database response boundary
    const result = onsiteSnapshotSchema.safeParse(input);
    // Then ambiguous input is rejected
    expect(result.success).toBe(false);
  });
});
