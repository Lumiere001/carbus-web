import { TRANSPORT_MODES } from "@/lib/transport/labels";
import type { RegistrationJourneyLeg } from "@/lib/registrations/journey";

export function journeyLegsOf(legs: Readonly<Record<string, { mode: string; status: string; via: string | null; viaUnitId?: string | null }>>, id: string): RegistrationJourneyLeg[] {
  return (["up", "down"] as const).flatMap((direction) => {
    const raw = legs[`${id}:${direction}`];
    const mode = TRANSPORT_MODES.find((value) => value === raw?.mode);
    return raw && mode ? [{ direction, mode, via_unit_id: raw.viaUnitId ?? null, status: raw.status === "pending" ? "pending" as const : "confirmed" as const }] : [];
  });
}
