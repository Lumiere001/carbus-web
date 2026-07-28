/**
 * 배차 select 의 호차 옵션 계산 (순수 함수).
 *
 * 화면에서 고를 수 있는 선택지를 **서버가 허용하는 집합과 정확히 일치**시키는 게 목적이다.
 * 예전엔 전 호차를 보여줘서, 편이 다른 호차를 고르면 서버(validateAssign)가 거절했다.
 *
 * 규칙 (상·하행 대칭 — 서버 lib/admin/registrations.ts 의 판정과 1:1 대응):
 * - 신청한 편이 null 이면 옵션 0개. 서버가 "상행/하행 대상이 아닙니다"로 거절하는 집합과 같다.
 * - 그 방향을 운행하지 않는 호차(해당 trip_id 가 null)는 제외. 서버의
 *   "N호차는 하행을 운행하지 않습니다" 와 같다.
 * - 편이 다른 호차도 제외. 서버의 "출발/귀가 시간대가 다릅니다" 와 같다.
 * - 이미 배정된 호차는 편이 달라도 목록에 남긴다. 안 그러면 select 의 value 가
 *   사라져 표시가 깨지고, 기존 배정을 바꿀 수도 없게 된다.
 *
 * 잔여석은 **정원(capacity)** 기준이다. 보조석(hard_cap)은 좌석이 모자랄 때만 쓰는
 * 최후 한도라, 그걸로 표기하면 만석 호차가 "잔여 1"로 보여 보조석을 소진하게 된다.
 *
 * ⚠️ up_trip_id / down_trip_id 는 **선택 필드로 만들지 마라.** 예전엔 옛 컬럼명을
 * `departure_slot_id?: number` 로 선언해뒀는데, 3-A 가 buses 의 그 컬럼을 up_trip_id 로
 * rename 한 뒤에도 이 파일만 옛 이름으로 남았다. 선택 필드라 타입 검사가 못 잡았고,
 * 화면이 넘기는 객체에는 그 키가 아예 없어 비교가 **항상 false** 가 되면서 상행 드롭다운이
 * 통째로 비었다. 단위 테스트는 픽스처가 옛 키를 갖고 있어 전부 통과했다.
 * 필수 필드로 두면 컬럼이 또 바뀔 때 tsc 가 즉시 잡는다.
 */
export type BusOption = {
  id: number;
  name: string;
  up_trip_id: number | null;
  down_trip_id: number | null;
  capacity: number;
  /**
   * 차량 종류 (§26-E). 간사 차량은 **여기서 고를 수 없다** — DB 가드가
   * "고정 탑승자로 지정되지 않은 사람의 간사 차 배정" 을 거부하므로, 목록에 두면
   * 고를 수는 있는데 저장이 거부되는 상태가 된다(이 레포에서 이미 네 번 나온 결함).
   * 간사 차 탑승자는 리더 화면에서 고정 탑승자로 지정한다.
   */
  kind: "bus" | "staff_car";
};

export type BusOptionView = { id: number; name: string; seatsLeft: number };

export function busSelectOptions(
  buses: BusOption[],
  which: "up" | "down",
  /** 학우가 **그 방향으로** 신청한 편. 그 방향을 안 쓰면 null. */
  tripId: number | null,
  /** 현재 배정된 호차 id (없으면 null). */
  current: number | null,
  /** 호차별 배정 인원. 본인 포함이라 자기 호차는 1석 보수적으로 보인다. */
  used: Map<number, number>
): BusOptionView[] {
  return buses
    .filter((b) => {
      if (b.id === current) return true;
      // 간사 차량은 이 드롭다운으로 배정할 수 없다 — DB 가드가 막는다.
      // 이미 그 차에 타 있는 사람(b.id === current)은 위에서 남겼으므로,
      // 배정을 **푸는** 것은 여기서도 된다.
      if (b.kind === "staff_car") return false;
      if (tripId == null) return false;
      const busTrip = which === "up" ? b.up_trip_id : b.down_trip_id;
      return busTrip != null && busTrip === tripId;
    })
    .map((b) => ({
      id: b.id,
      name: b.name,
      seatsLeft: Math.max(0, b.capacity - (used.get(b.id) ?? 0)),
    }));
}
