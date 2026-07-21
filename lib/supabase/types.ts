/**
 * Supabase 타입 alias + 보조 타입.
 *
 * Database 전체 타입은 `database.types.ts` (gen-types로 자동 생성).
 * 변경 후 재생성:
 *   pnpm supabase gen types typescript --project-id <your-project-ref> \
 *     --schema public > lib/supabase/database.types.ts
 */

import type { Database } from "./database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];
export type AttendanceType = Database["public"]["Enums"]["attendance_type"];
export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type SystemPhase = Database["public"]["Enums"]["system_phase"];

/**
 * 운행편 (event_trips 행). 상행(up)·하행(down)을 같은 구조로 다룬다.
 *
 * `departure_slots` 는 이제 event_trips 의 상행 편만 보여주는 전환용 뷰다.
 * 뷰 타입은 NOT NULL 정보를 잃어 전부 nullable 이 되므로 테이블 타입을 가리킨다.
 */
export type EventTrip = Database["public"]["Tables"]["event_trips"]["Row"];
export type TripDirection = "up" | "down";

/** @deprecated 상행 편을 뜻하던 옛 이름. 새 코드는 EventTrip 을 쓸 것. */
export type DepartureSlot = EventTrip;

/** profiles 행 (조회 시 자주 쓰는 형태). */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileMini = Pick<Profile, "role" | "campus_id" | "display_name">;
