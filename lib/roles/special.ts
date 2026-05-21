/**
 * 특수 역할 라벨 — 배차와 연동되는 역할.
 *
 * 일반 역할(총단·간사 등)은 표시용 칩일 뿐이지만, 아래 두 역할은 배차 시스템과
 * 연동된다: 이 역할을 가진 사람은 자신이 타는 방향(상행/하행)에 대해 반드시
 * 호차(차량순장 또는 고정탑승)가 지정되어야 하며, 미지정 시 배차가 차단된다.
 *
 * 라벨 문자열은 role_labels 테이블 / registrations.roles[] 에 그대로 저장된다.
 * (마이그 20260521120000 에서 시드)
 */
export const ROLE_DRIVER = "차량 순장";
export const ROLE_FIXED = "고정 탑승자";

/** 배차 연동 특수 역할 목록. */
export const SPECIAL_ROLES = [ROLE_DRIVER, ROLE_FIXED] as const;

/** 라벨이 특수 역할인지. */
export function isSpecialRole(label: string): boolean {
  return label === ROLE_DRIVER || label === ROLE_FIXED;
}
