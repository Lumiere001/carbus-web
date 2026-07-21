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
 * - roundtrip + departure_slot_id(상행 슬롯) + uses_return_bus=true : 완참
 * - oneway + departure_slot_id(상행 슬롯) + uses_return_bus=false  : 편도-상행
 * - oneway + departure_slot_id=null + uses_return_bus=true          : 편도-하행
 */
export interface Passenger {
  id: string;
  name: string;
  /** 캠퍼스 식별자 (UUID 또는 라벨). 같은 값끼리 같은 호차 우선 묶음. */
  campus: string;
  attendance_type: AttendanceType;
  /** 상행 출발 슬롯 id. 편도-하행은 null. */
  departure_slot_id: number | null;
  /** 하행 차량 이용 여부. */
  uses_return_bus: boolean;
  /**
   * 고정 상행 호차 id. driver_registration_id / fixed_passenger_ids 에서 유도.
   * null 이면 자유 배정 대상.
   */
  fixed_up_bus_id: number | null;
}

/**
 * 호차 (buses Row → 순수 입력으로 투영).
 *
 * 상행은 호차별 출발 슬롯(departure_slot_id)으로 운행. 하행은 슬롯 무관 전 호차 운행.
 */
export interface Bus {
  id: number;
  name: string;
  /** 정원 (기본 44). */
  capacity: number;
  /** 최대 정원 (기본 45). capacity 초과 시 fallback 한계. */
  hard_cap: number;
  /** 상행 운행 슬롯 id. */
  departure_slot_id: number;
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
