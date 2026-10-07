import type { RegistrationJourneyLeg } from "@/lib/registrations/journey";
import type { updateRegField } from "@/lib/admin/registrations";
import type { AdminRegRow, CampusInfo } from "@/components/admin/registrations-panel";
import type { LegValue } from "@/components/admin/transport-picker";
import type { EventTrip } from "@/lib/supabase/types";

export type PickupRow = {
  readonly id: number;
  readonly direction: "up" | "down";
  readonly pickupAt: string | null;
  readonly placeName: string | null;
  readonly note: string | null;
};

export type RegDrawerProps = {
  readonly row: AdminRegRow;
  readonly journeyLegs?: readonly RegistrationJourneyLeg[];
  readonly campuses: CampusInfo[];
  readonly trips: EventTrip[];
  readonly units: { id: string; name: string }[];
  readonly upLeg: LegValue;
  readonly downLeg: LegValue;
  /** 중간 합류·중간 이탈 등 한 사람에게 여러 수송 요청이 있을 수 있다. */
  readonly pickups: PickupRow[];
  /** 총단이 이 행사에 등록한 장소 목록에서만 고른다. */
  readonly places: { id: number; name: string }[];
  /** 날짜가 아니라 행사 몇째 날인지와 HH:MM 시각을 저장한다. */
  readonly courses: { dayNo: number; atTime: string | null }[];
  readonly dayCount: number;
  /** 부모가 최신 목록을 읽는다. 저장 중 서랍을 다시 마운트하지 않는다. */
  readonly onSaved: (label: string) => void;
  /** 캠퍼스 화면은 기본 정보를 기본적으로 제외한다. */
  readonly variant?: "master" | "campus";
  readonly includeBasics?: boolean;
  readonly onClose: () => void;
};

export type DrawerStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saved"; readonly field: string }
  | { readonly kind: "err"; readonly text: string };

export type SaveRegField = (
  label: string,
  expected: Partial<AdminRegRow>,
  patch: Parameters<typeof updateRegField>[2]
) => void;

export type PickupDraft = {
  readonly direction: "up" | "down";
  readonly at: string;
  readonly placeId: string;
  readonly note: string;
};
