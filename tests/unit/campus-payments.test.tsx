// @vitest-environment happy-dom
/**
 * 캠퍼스 정산 화면 — 송금 "맞나요?" 승인 카드.
 *
 * 배경(실측): 운영 `campus_remittances` 가 **0행**이었다. 기능은 있는데 아무도 안 썼다.
 * 반면 총단은 17개 캠퍼스 중 14곳에서 2,095만원을 **받았다고 기록**해 뒀다.
 * 즉 숫자는 이미 총단 장부에 있고, 임역원에게 부족했던 건 "직접 계산해서 넣기"였다.
 * 그래서 임역원은 **확인만** 하게 바꿨다.
 *
 * 지키려는 계약:
 *   ① 등록하는 금액은 총단 기록 전체가 아니라 **아직 안 올라온 차이**다.
 *      전체를 넣으면 이미 등록한 몫이 이중 계상된다.
 *   ② 승인 카드와 기존 유도 배너는 **동시에 뜨지 않는다.** 둘 다 뜨면 "얼마를
 *      등록하라는 건지"가 두 가지가 돼 오히려 손이 멈춘다.
 *   ③ 총단이 아직 기록을 안 했으면 카드는 안 뜨고 배너가 나온다.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import {
  CampusPaymentsPanel,
  type PayRow,
  type RemittanceRow,
} from "@/components/campus/payments-panel";

const addRemittance = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/lib/campus/payments", () => ({
  setPaymentStatus: async () => ({ ok: true as const }),
  addRemittance: (...a: unknown[]) => addRemittance(...(a as [])),
  deleteRemittance: async () => ({ ok: true as const }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

/** 완납 2명 = 걷힌 10만원. */
const ROWS: PayRow[] = [
  {
    id: "r1",
    name: "김순장",
    student_id: "23",
    attendance_type: "roundtrip",
    fee: 50000,
    payment_status: "paid",
  },
  {
    id: "r2",
    name: "이순원",
    student_id: "24",
    attendance_type: "roundtrip",
    fee: 50000,
    payment_status: "paid",
  },
];

const remit = (amount: number): RemittanceRow => ({
  id: `remit-${amount}`,
  amount,
  note: null,
  created_at: "2026-07-20T09:00:00+09:00",
});

function renderPanel(opts: {
  remittances?: RemittanceRow[];
  masterReceived: number;
}) {
  return render(
    <CampusPaymentsPanel
      campusName="전남대"
      rows={ROWS}
      remittances={opts.remittances ?? []}
      masterReceived={opts.masterReceived}
      masterReceivedAt={null}
    />
  );
}

describe("송금 승인 카드", () => {
  beforeEach(() => {
    cleanup();
    addRemittance.mockClear();
  });

  it("총단 기록이 있으면 확인 카드가 뜨고, 유도 배너는 뜨지 않는다", () => {
    renderPanel({ masterReceived: 100000 });
    expect(screen.getByText("총단 기록을 확인해 주세요")).toBeTruthy();
    expect(screen.queryByText(/아직 총단에\s*등록되지 않았습니다/)).toBeNull();
  });

  it("이미 등록한 몫은 빼고 차이만 등록한다 (이중 계상 방지)", async () => {
    renderPanel({ masterReceived: 100000, remittances: [remit(30000)] });
    await act(async () => {
      fireEvent.click(screen.getByText(/맞아요/));
    });
    expect(addRemittance).toHaveBeenCalledWith(70000, "총단 기록 확인");
  });

  it("총단이 아직 기록을 안 했으면 카드 대신 기존 배너가 나온다", () => {
    renderPanel({ masterReceived: 0 });
    expect(screen.queryByText("총단 기록을 확인해 주세요")).toBeNull();
    expect(screen.getByText(/아직 총단에/)).toBeTruthy();
  });

  it("총단 기록이 내 등록보다 많지 않으면 카드는 안 뜬다", () => {
    renderPanel({ masterReceived: 100000, remittances: [remit(100000)] });
    expect(screen.queryByText("총단 기록을 확인해 주세요")).toBeNull();
  });

  it("‘금액이 달라요’를 누르면 카드가 접히고 직접 입력 경로가 남는다", async () => {
    renderPanel({ masterReceived: 100000 });
    await act(async () => {
      fireEvent.click(screen.getByText("금액이 달라요"));
    });
    expect(screen.queryByText("총단 기록을 확인해 주세요")).toBeNull();
    expect(addRemittance).not.toHaveBeenCalled();
    expect(screen.getByText("송금 추가")).toBeTruthy();
  });
});
