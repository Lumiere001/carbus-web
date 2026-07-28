// @vitest-environment happy-dom
/**
 * 편집 서랍(RegDrawer) — 저장 계약 테스트.
 *
 * 왜 필요한가 — 이 화면은 master 로그인 뒤에만 열려서 브라우저로 확인할 수가 없다.
 * 그리고 여기서 회귀하면 **조용히 데이터를 덮는다.** 저장 버튼이 없어서 사용자가
 * "저장했다"는 순간을 인지하지 못하기 때문에, 잘못 보내도 아무도 눈치채지 못한다.
 *
 * 지키려는 계약 두 가지:
 *   ① 고친 칸 **하나만** 보낸다. 통째로 보내면 내가 안 건드린 칸이 내가 열었을 때의
 *      값으로 되돌아가고, 그 사이 다른 사람이 고친 것이 덮인다.
 *   ② `expected` 에 **내가 보던 값**을 실어 보낸다. 이게 있어야 updateCells 가
 *      충돌을 감지한다. 빠뜨리면 낙관 락이 통째로 무력해진다.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { RegDrawer } from "@/components/admin/reg-drawer";
import type { AdminRegRow } from "@/components/admin/registrations-panel";

const updateRegField = vi.fn(async () => ({ ok: true as const }));
const setTransportLeg = vi.fn(async () => ({ ok: true as const }));
const addPickup = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/lib/admin/registrations", () => ({
  updateRegField: (...args: unknown[]) => updateRegField(...(args as [])),
}));
vi.mock("@/lib/admin/transport", () => ({
  setTransportLeg: (...args: unknown[]) => setTransportLeg(...(args as [])),
}));
vi.mock("@/lib/admin/pickup", () => ({
  addPickup: (...args: unknown[]) => addPickup(...(args as [])),
  deletePickup: async () => ({ ok: true as const }),
  setAttendRange: async () => ({ ok: true as const }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// 좌석 반납 확인창. 뜨는 것 자체가 옳은 동작이라 막지 않고 "예"로 답한다.
window.confirm = vi.fn(() => true);

const ROW: AdminRegRow = {
  id: "reg-1",
  name: "김순장",
  student_id: "23",
  campus_id: "campus-a",
  attendance_type: "roundtrip",
  up_trip_id: 10,
  down_trip_id: 20,
  fee: 50000,
  payment_status: "unpaid",
  roles: [],
  note: "기존 비고",
  assigned_up_bus_id: 1,
  assigned_down_bus_id: 2,
  participation_status: "registered",
  cancel_reason: null,
  attend_from: null,
  attend_to: null,
};

const CAMPUSES = [
  { id: "campus-a", name: "전남대", display_order: 1 },
  { id: "campus-b", name: "조선대", display_order: 2 },
];
const TRIPS = [
  { id: 10, label: "화 오전 9시", direction: "up", active: true, display_order: 10 },
  { id: 20, label: "금 오후 3시", direction: "down", active: true, display_order: 10 },
  { id: 21, label: "금 오후 6시", direction: "down", active: true, display_order: 20 },
] as never;

const OUR_BUS = { mode: "our_bus", viaUnitId: null, status: "confirmed" } as const;

function renderDrawer() {
  return render(
    <RegDrawer
      row={ROW}
      campuses={CAMPUSES}
      trips={TRIPS}
      units={[{ id: "unit-1", name: "경주지구" }]}
      upLeg={{ ...OUR_BUS }}
      downLeg={{ ...OUR_BUS }}
      pickups={[]}
      places={[]}
      onSaved={() => {}}
      onClose={() => {}}
    />
  );
}

describe("RegDrawer — 필드별 즉시 저장", () => {
  beforeEach(() => {
    cleanup();
    updateRegField.mockClear();
    setTransportLeg.mockClear();
  });

  it("납부만 바꾸면 납부 칸 하나만 보낸다", async () => {
    renderDrawer();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("납부"), { target: { value: "paid" } });
    });

    expect(updateRegField).toHaveBeenCalledTimes(1);
    const [id, expected, patch] = updateRegField.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(id).toBe("reg-1");
    // 내가 보던 값 = 충돌 감지 기준
    expect(expected).toEqual({ payment_status: "unpaid" });
    // 다른 칸(이름·편·비고)은 절대 실리면 안 된다
    expect(patch).toEqual({ payment_status: "paid" });
  });

  it("하행 편을 바꾸면 down_trip_id 만 보낸다 (상행은 건드리지 않는다)", async () => {
    renderDrawer();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("하행 (오는 편)"), {
        target: { value: "21" },
      });
    });

    const [, expected, patch] = updateRegField.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(expected).toEqual({ down_trip_id: 20 });
    expect(patch).toEqual({ down_trip_id: 21 });
    expect(patch).not.toHaveProperty("up_trip_id");
  });

  it("‘이용 안 함’을 고르면 null 로 보낸다 (빈 문자열이 아니라)", async () => {
    renderDrawer();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("상행 (가는 편)"), {
        target: { value: "" },
      });
    });

    const [, , patch] = updateRegField.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(patch).toEqual({ up_trip_id: null });
  });

  it("값을 안 바꾸고 빠져나가면 아무것도 보내지 않는다", async () => {
    renderDrawer();
    const nameInput = screen.getByLabelText("이름");
    await act(async () => {
      fireEvent.blur(nameInput);
    });
    expect(updateRegField).not.toHaveBeenCalled();
  });

  it("비고를 지우면 빈 문자열이 아니라 null 로 보낸다", async () => {
    renderDrawer();
    const note = screen.getByLabelText(/비고/);
    await act(async () => {
      fireEvent.change(note, { target: { value: "  " } });
      fireEvent.blur(note);
    });

    const [, expected, patch] = updateRegField.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(expected).toEqual({ note: "기존 비고" });
    expect(patch).toEqual({ note: null });
  });
});

/**
 * 이동수단은 **여러 칸이 모여야 한 값이 된다** — 회귀하면 기능 전체가 죽는다.
 *
 * 실제로 배포된 적이 있다: 타지구를 고르는 순간 저장을 시도했는데 지구가 아직
 * 없어 DB 가 거부했고, 거부되면 화면 값이 안 바뀌니 **지구 고르는 칸이 아예
 * 나타나지 않았다.** 그래서 "확정 대기"를 만들 방법이 없었고, 좌석 자동 반납도
 * 통째로 죽어 있었다. 화면상으로는 그냥 빨간 오류 한 줄로만 보인다.
 */
describe("RegDrawer — 이동수단 다단계 입력", () => {
  beforeEach(() => {
    cleanup();
    setTransportLeg.mockClear();
  });

  it("타지구를 고르면 지구 선택 칸이 나타난다", async () => {
    renderDrawer();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("갈 때 (상행) 이동수단"), {
        target: { value: "other_district" },
      });
    });
    expect(screen.getByLabelText("갈 때 (상행) 지구")).toBeTruthy();
  });

  it("지구를 고르기 전에는 저장하지 않는다 (거부당하면 칸이 안 열린다)", async () => {
    renderDrawer();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("갈 때 (상행) 이동수단"), {
        target: { value: "other_district" },
      });
    });
    expect(setTransportLeg).not.toHaveBeenCalled();
  });

  it("지구까지 고르면 그때 저장한다", async () => {
    renderDrawer();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("갈 때 (상행) 이동수단"), {
        target: { value: "other_district" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("갈 때 (상행) 지구"), {
        target: { value: "unit-1" },
      });
    });
    expect(setTransportLeg).toHaveBeenCalledTimes(1);
    const [, dir, input] = setTransportLeg.mock.calls[0] as unknown as [
      string,
      string,
      { mode: string; viaUnitId: string },
    ];
    expect(dir).toBe("up");
    expect(input.mode).toBe("other_district");
    expect(input.viaUnitId).toBe("unit-1");
  });

  it("확정 대기 체크박스도 타지구를 골라야 나타난다", async () => {
    renderDrawer();
    expect(screen.queryByText("확정 대기")).toBeNull();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("갈 때 (상행) 이동수단"), {
        target: { value: "other_district" },
      });
    });
    expect(screen.getByText("확정 대기")).toBeTruthy();
  });

  it("KTX 처럼 지구가 필요 없는 수단은 고르는 즉시 저장한다", async () => {
    renderDrawer();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("올 때 (하행) 이동수단"), {
        target: { value: "ktx" },
      });
    });
    expect(setTransportLeg).toHaveBeenCalledTimes(1);
  });
});

/**
 * 픽업 장소는 **총단이 등록한 목록에서 고른다.** 자유 입력이면 차가 실제로 가지
 * 않는 곳이 적히고, 표기도 사람마다 갈린다.
 */
describe("RegDrawer — 픽업 장소는 고르는 것", () => {
  beforeEach(cleanup);

  it("장소는 자유 입력이 아니라 선택 목록이다", () => {
    render(
      <RegDrawer
        row={ROW}
        campuses={CAMPUSES}
        trips={TRIPS}
        units={[{ id: "unit-1", name: "경주지구" }]}
        upLeg={{ ...OUR_BUS }}
        downLeg={{ ...OUR_BUS }}
        pickups={[]}
        places={[{ id: 7, name: "○○역" }]}
        onSaved={() => {}}
        onClose={() => {}}
      />
    );
    const el = screen.getByLabelText("픽업 장소");
    expect(el.tagName).toBe("SELECT");
    expect(screen.getByText("○○역")).toBeTruthy();
  });

  it("총단이 장소를 안 만들었으면 그 사실을 알려준다", () => {
    renderDrawer();
    expect(screen.getByText(/등록된 픽업 장소가 없습니다/)).toBeTruthy();
  });
});
