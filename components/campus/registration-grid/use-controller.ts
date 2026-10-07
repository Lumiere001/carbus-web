"use client";

import { useMemo, useState } from "react";
import { useConfirmation } from "@/components/ui/use-confirmation";
import { newerRegistration } from "./versions";
import { useRegistrationRoster } from "./use-roster";
import { updateCells } from "@/lib/registrations/mutations";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import { excludeRegistration, restoreRegistration } from "@/lib/admin/registrations";
import type { PaymentStatus } from "@/lib/supabase/types";
import type { CancellationRequest, RegistrationGridProps, TextEdit, Toast } from "./types";

export function useRegistrationGridController({ campusId, eventId, initialRows }: Pick<RegistrationGridProps, "campusId" | "eventId" | "initialRows">) {
  const { rows, setRows, membershipError, checkingMembership, confirmMembership } = useRegistrationRoster(campusId, eventId, initialRows);
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const [toast, setToast] = useState<Toast | null>(null);
  const [conflictCells, setConflictCells] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState<CancellationRequest | null>(null);
  const commands = useMemo(() => {
    function replaceRow(row: RegistrationRow) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? newerRegistration(r, row) : r)));
    }

    function flashConflict(id: string, fields: string[]) {
      const keys = fields.map((f) => `${id}:${f}`);
      setConflictCells((prev) => new Set([...prev, ...keys]));
      setTimeout(() => {
        setConflictCells((prev) => {
          const next = new Set(prev);
          keys.forEach((k) => next.delete(k));
          return next;
        });
      }, 2500);
    }

    /** 충돌 결과 공통 처리: 최신값 교체 + 토스트 + 셀 강조. */
    function handleConflict(
      id: string,
      res: { latest?: RegistrationRow; conflictFields?: string[]; message: string }
    ) {
      if (res.latest) replaceRow(res.latest);
      if (res.conflictFields?.length) flashConflict(id, res.conflictFields);
      setToast({ type: "err", text: res.message });
    }

    // 텍스트 셀 저장 (이름·학번·비고).
    async function saveText({ row, field, started, next }: TextEdit) {
      if (next === started) return; // 변경 없으면 skip
      const res = await updateCells(
        row.id,
        { [field]: started },
        { [field]: next }
      );
      if (!res.ok) {
        if (res.conflict) handleConflict(row.id, res);
        else setToast({ type: "err", text: res.message });
        return;
      }
      replaceRow(res.row);
    }

    /**
     * 상행·하행 편 변경.
     *
     * 두 개의 독립 select 로 보이지만 **DB write 는 반드시 한 번**이다.
     * 따로 보내면 (a) version 이 두 번 튀어 다른 임역원에게 충돌이 두 번 뜨고,
     * (b) 중간 상태(둘 다 null = 버스 미이용)가 잠깐 저장되면서 요금 트리거가
     * 0원을 찍는다. attendance_type 은 DB 파생이라 보내지 않는다.
     */
    async function saveTrips(
      row: RegistrationRow,
      patch: { up_trip_id?: number | null; down_trip_id?: number | null }
    ) {
      // 이미 낸 사람의 편성을 바꾸면 청구액이 **동결된 채로** 남는다(Phase 2-A 설계).
      // 실측: 왕복 5만원을 낸 사람의 편을 다 비워도 fee 는 50000 그대로고,
      // 장부 차액에도 안 잡혀서 아무도 환불 대상인 걸 모른다.
      // 3-C 로 편을 개별로 끄고 켜기 쉬워졌으니 최소한 이 순간에는 알려준다.
      if (row.payment_status === "paid") {
        const next = { ...row, ...patch };
        const ridesAfter = next.up_trip_id !== null || next.down_trip_id !== null;
        const msg = ridesAfter
          ? `${row.name}님은 이미 납부했습니다. 편을 바꿔도 청구액은 그대로 남습니다.`
          : `${row.name}님은 이미 납부했는데 버스를 아예 안 타게 됩니다.\n청구액은 자동으로 줄지 않으니 환불 여부를 따로 확인하세요.`;
        if (!await requestConfirmation({ title: "납부한 신청의 운행편을 바꿀까요?", description: msg, confirmLabel: "운행편 변경" })) return;
      }
      const res = await updateCells(
        row.id,
        { up_trip_id: row.up_trip_id, down_trip_id: row.down_trip_id },
        { up_trip_id: row.up_trip_id, down_trip_id: row.down_trip_id, ...patch }
      );
      if (!res.ok) {
        if (res.conflict) handleConflict(row.id, res);
        else setToast({ type: "err", text: res.message });
        return;
      }
      replaceRow(res.row);
    }

    // 납부 상태 변경.
    async function savePayment(row: RegistrationRow, status: PaymentStatus) {
      const res = await updateCells(
        row.id,
        { payment_status: row.payment_status },
        { payment_status: status }
      );
      if (!res.ok) {
        if (res.conflict) handleConflict(row.id, res);
        else setToast({ type: "err", text: res.message });
        return;
      }
      replaceRow(res.row);
    }

    /**
     * 신청 취소 — **지우지 않는다.**
     *
     * 예전엔 여기서 진짜 삭제(DELETE)를 시도했다. 그런데 DB 가 로그인한 사용자의
     * 삭제를 전부 막는다("삭제하면 납부·배차 기록이 함께 사라집니다"). 그래서
     * 임역원이 휴지통을 눌러도 **아무 일도 안 일어나고 에러만 떴다** — 버튼은
     * 있는데 되지 않는 상태였다.
     *
     * DB 는 원래부터 임역원 취소를 허용하도록 돼 있었다. 배차 가드에 "그러면
     * 임역원이 취소를 아예 못 하게 된다" 는 예외가 명시돼 있다(20260721040000).
     * 화면만 잘못된 함수를 부르고 있었다.
     */
    async function handleCancel(row: RegistrationRow, reason: string) {
      setAsk(null);
      const res = await excludeRegistration(row.id, reason || null);
      if (!res.ok) {
        setToast({ type: "err", text: res.message });
        return;
      }
      // 행을 지우지 않는다 — 취소 표시로 남겨야 되돌릴 수 있고, 무엇이 취소됐는지도 보인다.
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id && r.version === row.version
            ? {
                ...r,
                participation_status: "cancelled" as const,
                cancel_reason: reason || null,
                assigned_up_bus_id: null,
                assigned_down_bus_id: null,
              }
            : r
        )
      );
      // The write returns no version; confirm rather than inventing a committed one.
      void confirmMembership();
      setToast({ type: "ok", text: `${row.name} 신청 취소됨 (좌석 반납)` });
    }

    /** 취소 되돌리기. 좌석은 자동 복구하지 않는다 — 다른 분이 이미 앉았을 수 있다. */
    async function handleRestore(row: RegistrationRow) {
      setAsk(null);
      const res = await restoreRegistration(row.id);
      if (!res.ok) {
        setToast({ type: "err", text: res.message });
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id && r.version === row.version
            ? { ...r, participation_status: "registered" as const, cancel_reason: null }
            : r
        )
      );
      void confirmMembership();
      setToast({
        type: "ok",
        text: `${row.name} 취소 되돌림 — 배차는 총단이 다시 지정합니다`,
      });
    }

    return { saveText, saveTrips, savePayment, handleCancel, handleRestore };
  }, [setRows, requestConfirmation, confirmMembership]);

  return { rows, toast, conflictCells, ask, setAsk, commands, confirmationDialog, membershipError, checkingMembership, confirmMembership };
}
