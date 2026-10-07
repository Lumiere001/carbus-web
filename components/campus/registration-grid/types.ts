import type { RegistrationRow } from "@/lib/registrations/mutations";
import type { EventTrip } from "@/lib/supabase/types";
import type { PickupRow } from "@/components/admin/reg-drawer";

export type Bus = { readonly id: number; readonly name: string };
export type Toast = { readonly type: "ok" | "err"; readonly text: string };
export type TextField = "name" | "student_id" | "note";
export type TextEdit = { readonly row: RegistrationRow; readonly field: TextField; readonly started: string; readonly next: string };
export type CancellationRequest = { readonly kind: "cancel" | "restore"; readonly row: RegistrationRow };

export type RegistrationGridProps = {
  readonly eventId: string | null;
  readonly campusId: string;
  readonly campusName: string;
  readonly initialRows: RegistrationRow[];
  readonly buses: Bus[];
  readonly trips: EventTrip[];
  /** "<신청id>:<방향>" → 이동수단. 행이 없으면 우리 버스(기본값). */
  readonly legs: Record<string, { mode: string; status: string; via: string | null }>;
  /** 타지구 차량일 때 고를 지구 목록. */
  readonly units: { id: string; name: string }[];
  /** 신청id → 수송 요청들. */
  readonly pickups: Record<string, PickupRow[]>;
  /** 총단이 등록해 둔 픽업 장소. 고르기만 한다. */
  readonly places: { id: number; name: string }[];
  /** 사람별 수강신청 — 날짜가 아니라 몇째 날이다. */
  readonly courses: Record<string, { dayNo: number; atTime: string | null }[]>;
  /** 이 행사에서 고를 수 있는 날 수 (행사 기간에서 계산). */
  readonly dayCount: number;
};
