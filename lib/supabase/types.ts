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

/** 출발 슬롯 (departure_slots 행). 상행 출발 시간대 = 배차 제약. */
export type DepartureSlot = Database["public"]["Tables"]["departure_slots"]["Row"];

/** profiles 행 (조회 시 자주 쓰는 형태). */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileMini = Pick<Profile, "role" | "campus_id" | "display_name">;
