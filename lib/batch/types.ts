/**
 * 배차 알고리즘 순수 타입 (reference/batch_algorithm.md §4)
 *
 * DB Row 와 분리한 순수 입력 타입. 배차 엔진은 side effect 없이
 * 이 타입들만 받아 BatchResult 를 반환한다. (DB·fetch 의존 X)
 */

export type AttendanceType = "roundtrip" | "oneway" | "self";

/**
 * 신청자 (registrations Row → 순수 입력으로 투영).
 *
 * 참여 형태는 두 편의 조합으로 **완전히 결정된다**(attendance_type 은 파생값):
 * - up_trip_id O + down_trip_id O : 왕복
 * - 정확히 하나만 O               : 편도(상행 또는 하행)
 * - 둘 다 X                       : 버스 미이용
 */
export interface Passenger {
  id: string;
  name: string;
  /** 캠퍼스 식별자 (UUID 또는 라벨). 같은 값끼리 같은 호차 우선 묶음. */
  campus: string;
  attendance_type: AttendanceType;
  /** 신청한 **상행 편** id. NULL = 상행 미이용. (옛 departure_slot_id) */
  up_trip_id: number | null;
  /**
   * 신청한 **하행 편** id. NULL = 하행 미이용.
   * 예전엔 uses_return_bus 불린이라 "탄다/안 탄다"만 말할 수 있었고,
   * 그래서 하행을 여러 편으로 나눠도 신청자가 편을 고를 수 없었다.
   */
  down_trip_id: number | null;
  /**
   * 고정 상행 호차 id. driver_registration_id / fixed_passenger_ids 에서 유도.
   * null 이면 자유 배정 대상.
   */
  fixed_up_bus_id: number | null;
}

/**
 * 호차 (buses Row → 순수 입력으로 투영).
 *
 * 차량은 상·하행 편을 각각 갖는다. NULL 이면 그 방향을 운행하지 않는다.
 */
export interface Bus {
  id: number;
  name: string;
  /** 정원 (기본 44). */
  capacity: number;
  /** 최대 정원 (기본 45). capacity 초과 시 fallback 한계. */
  hard_cap: number;
  /**
   * 이 차량이 운행하는 **상행 편** id. NULL 이면 상행을 운행하지 않는다.
   * (예전 departure_slot_id. 하행이 대칭 승격되면서 이름과 nullability 가 바뀌었다.)
   */
  up_trip_id: number | null;
  /** 이 차량이 운행하는 **하행 편** id. NULL 이면 하행을 운행하지 않는다. */
  down_trip_id: number | null;
  /** 상행 차량순장 신청자 id. 해당 호차에서 절대 이동 X. */
  driver_registration_id: string | null;
  /** 상행 고정 탑승자 id 목록. 해당 호차에서 절대 이동 X. */
  fixed_passenger_ids: string[];
  /** 하행 차량순장 신청자 id (상행과 별개). 해당 호차에서 절대 이동 X. */
  down_driver_registration_id: string | null;
  /** 하행 고정 탑승자 id 목록 (상행과 별개). 해당 호차에서 절대 이동 X. */
  down_fixed_passenger_ids: string[];
  /**
   * 차량순장 캠퍼스 우선 배치(응집, 3-1)에서 제외할 호차.
   * 여러 캠퍼스가 섞이는 차(임원·총단 차)에 켠다. 상·하행 모두에 적용.
   *
   * 예전엔 `name === "1호차"` 로 판정했다. 이름은 코드에 박힌 값이라
   * 다른 행사에서 짐차 이름이 바뀌면 **에러 없이 조용히** 특례가 사라졌다.
   */
  is_cohesion_exempt: boolean;
  /**
   * 채움 순서. 클수록 나중에 채운다(0 = 보통).
   * 짐을 함께 싣는 차는 1 이상으로 두어 빈자리를 최대한 남긴다.
   * 좌석이 부족하면 후순위 차도 결국 쓰인다 — 미배정을 만들지는 않는다.
   */
  fill_priority: number;
  /**
   * 차량 종류. `staff_car`(간사 차량)는 **자동 배차 대상이 아니다** — 크루·미디어·
   * 총단이 수동으로 지정돼 타는 차다(§26-E).
   *
   * ⚠️ `fill_priority` 로는 대신할 수 없다. 그건 "나중에 채운다" 일 뿐이라 좌석이
   * 모자라면 결국 캠퍼스 인원이 밀려 들어간다. 종류로 갈라야 한다.
   *
   * ⚠️ 선택 필드(`?`)로 두지 않는다 — DB 컬럼을 담는 필드를 선택으로 만들면
   * select 에서 빠져도 `tsc` 가 못 잡는다(§4-9 가 실제로 그렇게 blocker 를 놓쳤다).
   */
  kind: "bus" | "staff_car";
}

/** 한 신청자의 상·하행 배정 결과. */
export interface Assignment {
  up_bus_id: number | null;
  down_bus_id: number | null;
}

/** 배차 실행 결과. */
export interface BatchResult {
  /** 상행이 배정된 인원 수. */
  total_assigned: number;
  /** 호차 id별 상행 탑승 인원 수. */
  by_bus: Record<number, number>;
  /** 상행 기준 전 호차 빈 좌석 합계. */
  empty_seats: number;
  /** 미배정·검증 실패 사유 목록. */
  errors: string[];
  /** 신청자 id별 상행 배정 (배정된 사람만). */
  up_assignments: Record<string, number>;
  /** 신청자 id별 하행 배정 (배정된 사람만). */
  down_assignments: Record<string, number>;
}
