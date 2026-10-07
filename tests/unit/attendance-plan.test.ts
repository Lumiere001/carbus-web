import { describe, expect, it } from "vitest";
import { isPartialAttendance, validateAttendancePlan, type AttendancePlanLeg } from "@/lib/registrations/attendance-plan";

const full = { attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null, up_trip_id: 1, down_trip_id: 2, legs: [] };
const times = { attend_from_at: "2026-10-10T09:30:00+09:00", attend_to_at: "2026-10-12T19:40:00+09:00" };
const self: readonly AttendancePlanLeg[] = [{ direction: "down", mode: "own_car", status: "confirmed" }];

describe("확정한 참여 기간", () => {
  it("기존 전 일정 왕복 신청에는 시각을 만들지 않는다", () => {
    // Given / When / Then
    expect(validateAttendancePlan(full)).toEqual({ ok: true });
  });
  it("전 일정 편도 버스 신청을 부분 참석으로 바꾸지 않는다", () => {
    // Given
    const input = { ...full, ...times, down_trip_id: null, legs: self };
    // When / Then
    expect(validateAttendancePlan(input)).toEqual({ ok: true });
    expect(isPartialAttendance(input)).toBe(false);
  });
  it.each([
    { down_trip_id: null, legs: self },
    { legs: [{ direction: "up", mode: "other_district", status: "pending" }] satisfies readonly AttendancePlanLeg[] },
    { attend_from: "2026-10-10", attend_to: "2026-10-12" },
  ])("부분 참석·버스 미이용·타지구 대기는 모두 확정 일시가 필요하다 (%o)", (patch) => {
    // Given / When / Then
    expect(validateAttendancePlan({ ...full, ...patch })).toMatchObject({ ok: false, field: "attend_from_at" });
  });
  it("빠진 버스 방향에 기본 우리 버스를 적용하지 않는다", () => {
    // Given / When / Then
    expect(validateAttendancePlan({ ...full, ...times, down_trip_id: null })).toMatchObject({ ok: false, field: "legs" });
  });
  it.each([
    { attend_from_at: "2026-10-10", attend_to_at: times.attend_to_at },
    { attend_from_at: times.attend_from_at, attend_to_at: null },
    { attend_from_at: times.attend_from_at, attend_to_at: times.attend_from_at },
    { attend_from_at: "infinity", attend_to_at: times.attend_to_at },
    { attend_from_at: "2026-10-10T09:30", attend_to_at: times.attend_to_at },
  ])("날짜만·절반·역순·무한·시간대 없는 시각을 거부한다 (%o)", (patch) => {
    // Given / When / Then
    expect(validateAttendancePlan({ ...full, ...patch }).ok).toBe(false);
  });
  it("한국 날짜는 UTC 저장 날짜와 달라도 참여 날짜에 맞게 읽는다", () => {
    // Given
    const input = { ...full, attend_from: "2026-10-10", attend_to: "2026-10-11",
      attend_from_at: "2026-10-09T15:30:00Z", attend_to_at: "2026-10-10T17:00:00Z" };
    // When / Then
    expect(validateAttendancePlan(input)).toEqual({ ok: true });
  });
  it("일시에 담긴 한국 날짜와 기존 참여 날짜가 다르면 거부한다", () => {
    // Given / When / Then
    expect(validateAttendancePlan({ ...full, ...times, attend_from: "2026-10-11", attend_to: "2026-10-12" })).toMatchObject({ ok: false, field: "attend_from_at" });
  });
  it("부분 참석 날짜가 절반만 있으면 거부한다", () => {
    // Given / When / Then
    expect(validateAttendancePlan({ ...full, ...times, attend_from: "2026-10-10" })).toMatchObject({ ok: false, field: "attend_from" });
  });
});
