/**
 * 배차 select 의 호차 옵션 계산 (순수 함수).
 *
 * 화면에서 고를 수 있는 선택지를 **서버가 허용하는 집합과 정확히 일치**시키는 게 목적이다.
 * 예전엔 전 호차를 보여줘서, 슬롯이 다른 호차를 고르면 서버(validateAssign)가 거절했다.
 *
 * 규칙:
 * - 상행: 학우의 출발 슬롯과 같은 호차만. 하행 편도(departure_slot_id=null)면 옵션이 0개가
 *   되고 '미배정'만 남는다 — 서버가 "상행 대상이 아닙니다"로 거절하는 집합과 같다.
 * - 하행: 전 호차가 운행하므로 슬롯 제한 없음(서버도 하행은 슬롯을 안 본다).
 * - 이미 배정된 호차는 슬롯이 달라도 목록에 남긴다. 안 그러면 select 의 value 가
 *   사라져 표시가 깨지고, 기존 배정을 바꿀 수도 없게 된다.
 *
 * 잔여석은 **정원(capacity)** 기준이다. 보조석(hard_cap)은 좌석이 모자랄 때만 쓰는
 * 최후 한도라, 그걸로 표기하면 만석 호차가 "잔여 1"로 보여 보조석을 소진하게 된다.
 */
export type BusOption = {
  id: number;
  name: string;
  departure_slot_id?: number;
  capacity: number;
};

export type BusOptionView = { id: number; name: string; seatsLeft: number };

export function busSelectOptions(
  buses: BusOption[],
  which: "up" | "down",
  /** 학우의 상행 출발 슬롯. 하행 편도면 null. */
  departureSlotId: number | null,
  /** 현재 배정된 호차 id (없으면 null). */
  current: number | null,
  /** 호차별 배정 인원. 본인 포함이라 자기 호차는 1석 보수적으로 보인다. */
  used: Map<number, number>
): BusOptionView[] {
  return buses
    .filter(
      (b) =>
        which === "down" ||
        b.departure_slot_id === departureSlotId ||
        b.id === current
    )
    .map((b) => ({
      id: b.id,
      name: b.name,
      seatsLeft: Math.max(0, b.capacity - (used.get(b.id) ?? 0)),
    }));
}
