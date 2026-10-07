// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPanel } from "@/components/admin/control-panel";
import type { SystemConfigRow } from "@/lib/admin/system-config";
const { setPhase, setBatchEnabled } = vi.hoisted(() => ({ setPhase: vi.fn(), setBatchEnabled: vi.fn() }));
vi.mock("@/lib/admin/system-config", () => ({ setPhase, setBatchEnabled }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const CONFIG: SystemConfigRow = { id: 1, current_phase: "phase2", batch_enabled: false, last_batch_at: null, phase2_started_at: null, updated_at: "2026-10-06T00:00:00Z" };
beforeEach(() => { setPhase.mockReset(); setBatchEnabled.mockReset(); });
afterEach(cleanup);
describe("운영 단계의 상태와 변경 행동", () => {
 it("현재 단계는 읽기 전용이고 변경 가능한 단계만 행동으로 제공한다", () => {
  render(<ControlPanel phase="phase1" batchEnabled={false} updatedAt={null} />);
  expect(screen.queryByRole("button", { name: /^입력 단계/ })).toBeNull();
  expect(screen.getByRole("button", { name: "마감 단계로 변경" })).toBeDefined();
 });
 it("확인을 취소하면 설정을 보내지 않는다", async () => {
  render(<ControlPanel phase="phase1" batchEnabled={false} updatedAt={null} />);
  fireEvent.click(screen.getByRole("button", { name: "마감 단계로 변경" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "취소" })); });
  expect(setPhase).not.toHaveBeenCalled();
 });
 it("성공한 단계 변경만 표시하고 다음 행동을 바꾼다", async () => {
  setPhase.mockResolvedValue({ ok: true, row: CONFIG });
  render(<ControlPanel phase="phase1" batchEnabled={false} updatedAt={null} />);
  fireEvent.click(screen.getByRole("button", { name: "마감 단계로 변경" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "운영 설정 변경" })); });
  expect(setPhase).toHaveBeenCalledWith("phase2");
  expect(screen.getByRole("button", { name: "입력 단계로 변경" })).toBeDefined();
 });
 it("실패한 활성화는 현재 상태를 유지하고 재시도할 수 있다", async () => {
  setBatchEnabled.mockResolvedValue({ ok: false, message: "연결을 확인하세요" });
  render(<ControlPanel phase="phase1" batchEnabled={false} updatedAt={null} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "활성화" })); });
  expect(screen.getByRole("alert").textContent).toContain("연결을 확인하세요");
  expect(screen.getByRole("button", { name: "활성화" })).toBeDefined();
 });
});
