// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventsPanel } from "@/components/admin/events-panel";
import { CampusPaymentsPanel } from "@/components/campus/payments-panel";
import { PaymentsPanel } from "@/components/admin/payments-panel";
import { ImportPanel } from "@/components/campus/import-panel";
import { createEvent } from "@/lib/admin/events";
import { addRemittance } from "@/lib/campus/payments";
import { setMasterReceived } from "@/lib/admin/payments";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import { insertRegistration } from "@/lib/registrations/mutations";
import type { ThreeWayRow } from "@/components/admin/payments-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/admin/events", () => ({ createEvent: vi.fn(), activateEvent: vi.fn(), updateEventFares: vi.fn() }));
vi.mock("@/lib/campus/payments", () => ({ addRemittance: vi.fn(), deleteRemittance: vi.fn(), setPaymentStatus: vi.fn() }));
vi.mock("@/lib/admin/payments", () => ({ setMasterReceived: vi.fn(), masterRemitFor: vi.fn() }));
vi.mock("@/lib/registrations/mutations", () => ({ insertRegistration: vi.fn() }));
const failure = { ok: false, message: "synthetic rejected write" } as const;
const paid = { campus_id: "c1", campus_name: "합성 캠퍼스", system_paid_total: 10000, campus_remitted_total: 10000,
  master_received_total: 10000, diff_system_vs_campus: 0, diff_campus_vs_master: 0, diff_system_vs_master: 0 } satisfies ThreeWayRow;
const campusId = "10000000-0000-4000-8000-000000000001";
const insertedRow = { id: "20000000-0000-4000-8000-000000000001", event_id: "e1", name: "합성 참가자", student_id: "26",
  campus_id: campusId, attendance_type: "oneway", up_trip_id: 1, down_trip_id: null, departure_slot_id: 1, uses_return_bus: false,
  assigned_up_bus_id: null, assigned_down_bus_id: null, attend_from: null, attend_to: null,
  payment_status: "unpaid", fee: 25000, roles: [], participation_status: "registered",
  cancelled_at: null, cancel_reason: null, cancelled_by: null, checked_in: false, checked_out: false,
  created_by: null, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z",
  version: 1, note: null, home_unit_id: null } satisfies RegistrationRow;
const trips = [{ id: 1, key: "up_1", label: "오전 출발", direction: "up", active: true }] as const;
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("진행 중 운영 초안 보존", () => {
  it("행사 생성 중 모든 입력을 잠그고 실패 후 입력한 이름을 남긴다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(createEvent).mockReturnValueOnce(reply.promise);
    render(<EventsPanel events={[]} counts={{}} />);
    await user.click(screen.getByRole("button", { name: "새 행사 시작" }));
    const name = screen.getByLabelText("행사 이름");
    await user.type(name, "새 행사");
    // When
    await user.click(screen.getByRole("button", { name: "행사 시작" }));
    // Then
    for (const control of [...screen.getAllByRole("textbox"), ...screen.getAllByRole("spinbutton"),
      ...screen.getAllByRole("checkbox"), screen.getByLabelText("시작일"), screen.getByLabelText("종료일")]) expect(control).toBeDisabled();
    await user.type(name, "다음 초안");
    expect(name).toHaveValue("새 행사");
    await act(async () => { reply.resolve(failure); });
    expect(name).toBeEnabled(); expect(name).toHaveValue("새 행사");
  });

  it("캠퍼스 송금 저장 중 금액·메모를 잠그고 실패 후 제출한 초안을 보존한다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(addRemittance).mockReturnValueOnce(reply.promise);
    render(<CampusPaymentsPanel campusName="합성 캠퍼스" rows={[]} remittances={[]} masterReceived={0} masterReceivedAt={null} />);
    const amount = screen.getByLabelText("보낸 금액"); const note = screen.getByLabelText("메모 (선택)");
    await user.type(amount, "12300"); await user.type(note, "첫 송금");
    // When
    await user.click(screen.getByRole("button", { name: "송금 추가" }));
    // Then
    expect(amount).toBeDisabled(); expect(note).toBeDisabled();
    await user.type(note, "다음 초안");
    expect(note).toHaveValue("첫 송금");
    await act(async () => { reply.resolve(failure); });
    expect(amount).toBeEnabled(); expect(amount).toHaveValue(12300); expect(note).toHaveValue("첫 송금");
  });

  it("총단 입금 저장 중 금액·다른 행 수정 진입을 잠그고 실패 후 기존 초안을 남긴다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(setMasterReceived).mockReturnValueOnce(reply.promise);
    render(<PaymentsPanel rows={[paid, {...paid, campus_id: "c2", campus_name: "다른 캠퍼스"}]} isMaster waived={[]} balances={[]} />);
    await user.click(screen.getAllByRole("button", { name: "입금 등록" })[0]);
    const amount = screen.getByRole("spinbutton", { name: "합성 캠퍼스 총단 확인 입금액" });
    await user.clear(amount); await user.type(amount, "20000");
    // When
    await user.click(screen.getByRole("button", { name: "저장" }));
    // Then
    expect(amount).toBeDisabled(); expect(screen.getByRole("button", { name: "입금 등록" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "입금 등록" }));
    expect(amount).toBeInTheDocument();
    await act(async () => { reply.resolve(failure); });
    expect(amount).toBeEnabled(); expect(amount).toHaveValue(20000);
  });

  it("CSV 등록 중 파일 교체를 막아 뒤의 미리보기가 오래된 완료로 지워지지 않는다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(insertRegistration).mockReturnValueOnce(reply.promise);
    const view = render(<ImportPanel campusId={campusId} trips={[...trips]} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("File control missing");
    await user.upload(input, new File(["이름,학번,상행 출발,하행 출발,비고\n합성 참가자,26,오전 출발,,"], "first.csv", {type: "text/csv"}));
    // When
    await user.click(screen.getByRole("button", { name: "1명 등록" }));
    // Then
    expect(input).toBeDisabled(); expect(screen.getByRole("button", { name: "CSV 파일 선택" })).toBeDisabled();
    await user.upload(input, new File(["이름,학번,상행 출발,하행 출발,비고\n다음 참가자,26,오전 출발,,"], "second.csv", {type: "text/csv"}));
    expect(screen.queryByText("다음 참가자")).toBeNull();
    await act(async () => { reply.resolve(failure); });
    expect(input).toBeEnabled(); expect(insertRegistration).toHaveBeenCalledTimes(1);
  });

  it("CSV 일부 등록 성공 뒤 나머지 실패는 기존 결과와 실패 목록으로 남긴다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(insertRegistration).mockResolvedValueOnce({ ok: true, row: insertedRow }).mockReturnValueOnce(reply.promise);
    const view = render(<ImportPanel campusId={campusId} trips={[...trips]} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("File control missing");
    await user.upload(input, new File(["이름,학번,상행 출발,하행 출발,비고\n합성 참가자,26,오전 출발,,\n다음 참가자,26,오전 출발,,"], "partial.csv", {type: "text/csv"}));
    // When
    await user.click(screen.getByRole("button", { name: "2명 등록" }));
    // Then
    expect(input).toBeDisabled(); expect(screen.getByRole("button", { name: "CSV 파일 선택" })).toBeDisabled();
    expect(insertRegistration).toHaveBeenCalledTimes(2);
    await act(async () => { reply.resolve(failure); });
    expect(input).toBeEnabled(); expect(screen.getByText(/등록 결과: 1명 성공/)).toHaveTextContent("1명 실패");
    expect(screen.getByText("다음 참가자 26")).toBeInTheDocument();
    expect(screen.queryByText("합성 참가자")).toBeNull(); expect(screen.queryByRole("button", { name: /명 등록/ })).toBeNull();
  });

  it("새 CSV를 읽는 동안 이전 미리보기 등록을 막고 읽은 파일로 바꾼다", async () => {
    // Given
    const user = userEvent.setup();
    const content = Promise.withResolvers<string>();
    const view = render(<ImportPanel campusId={campusId} trips={[...trips]} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("File control missing");
    await user.upload(input, new File(["이름,학번,상행 출발,하행 출발,비고\n합성 참가자,26,오전 출발,,"], "first.csv", {type: "text/csv"}));
    const nextFile = new File([""], "second.csv", {type: "text/csv"});
    vi.spyOn(nextFile, "text").mockReturnValueOnce(content.promise);
    // When
    await user.upload(input, nextFile);
    // Then
    expect(input).toBeDisabled(); expect(screen.getByRole("button", { name: "CSV 파일 선택" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1명 등록" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "1명 등록" }));
    expect(insertRegistration).not.toHaveBeenCalled();
    await act(async () => { content.resolve("이름,학번,상행 출발,하행 출발,비고\n다음 참가자,26,오전 출발,,"); });
    expect(input).toBeEnabled(); expect(screen.getByRole("button", { name: "1명 등록" })).toBeEnabled();
    expect(screen.getByText("다음 참가자")).toBeInTheDocument(); expect(screen.queryByText("합성 참가자")).toBeNull();
  });

});
