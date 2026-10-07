import type { RegistrationRow } from "@/lib/registrations/mutations";

export function newerRegistration(current: RegistrationRow, incoming: RegistrationRow): RegistrationRow {
  return incoming.version <= current.version ? current : incoming;
}

/** A confirmed list controls membership without downgrading existing row versions. */
export function reconcileRegistrationRows(incoming: RegistrationRow[], current: RegistrationRow[]): RegistrationRow[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  return incoming.map((row) => {
    const existing = byId.get(row.id);
    return existing ? newerRegistration(existing, row) : row;
  });
}

/** An unconfirmed SSR omission must not hide a newer Realtime registration. */
export function retainMissingRegistrationRows(incoming: RegistrationRow[], current: RegistrationRow[]): RegistrationRow[] {
  const ids = new Set(incoming.map((row) => row.id));
  return [...reconcileRegistrationRows(incoming, current), ...current.filter((row) => !ids.has(row.id))];
}
