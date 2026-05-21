import { describe, expect, it } from "vitest";
import { sortRoster, type RosterMember } from "@/lib/registrations/roster-sort";

const m = (name: string, student_id: string, campus_name: string): RosterMember => ({
  name,
  student_id,
  campus_name,
});

describe("sortRoster — 캠퍼스 묶음 + 학번 오름차순", () => {
  it("인원 많은 캠퍼스가 위로 묶인다", () => {
    const r = sortRoster([
      m("가", "22", "조선대"),
      m("나", "22", "전남대"),
      m("다", "23", "전남대"),
      m("라", "21", "전남대"),
    ]);
    // 전남대(3) 먼저, 조선대(1) 나중
    expect(r.map((x) => x.campus_name)).toEqual([
      "전남대",
      "전남대",
      "전남대",
      "조선대",
    ]);
  });

  it("캠퍼스 내부는 학번 오름차순(20→25)", () => {
    const r = sortRoster([
      m("가", "24", "전남대"),
      m("나", "21", "전남대"),
      m("다", "23", "전남대"),
    ]);
    expect(r.map((x) => x.student_id)).toEqual(["21", "23", "24"]);
  });

  it("학번 특수값('외국인'·'타지구')은 숫자 뒤로", () => {
    const r = sortRoster([
      m("외국A", "외국인", "전남대"),
      m("학생", "22", "전남대"),
      m("타지구원", "타지구", "전남대"),
    ]);
    expect(r[0].student_id).toBe("22");
    expect(r.slice(1).map((x) => x.student_id).sort()).toEqual(["외국인", "타지구"]);
  });

  it("같은 학번은 이름 가나다순", () => {
    const r = sortRoster([
      m("나정원", "22", "전남대"),
      m("가온", "22", "전남대"),
    ]);
    expect(r.map((x) => x.name)).toEqual(["가온", "나정원"]);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const orig = [m("가", "24", "전남대"), m("나", "21", "전남대")];
    const copy = [...orig];
    sortRoster(orig);
    expect(orig).toEqual(copy);
  });

  it("빈 배열도 안전", () => {
    expect(sortRoster([])).toEqual([]);
  });
});
