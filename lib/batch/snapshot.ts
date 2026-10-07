import { z } from "zod";

const tripId = z.number().int().positive().nullable();
const busId = z.number().int().positive().nullable();
const registration = z.object({
  id: z.string().uuid(),
  name: z.string(),
  campus_id: z.string().uuid(),
  attendance_type: z.enum(["roundtrip", "oneway", "self"]),
  up_trip_id: tripId,
  down_trip_id: tripId,
  assigned_up_bus_id: busId,
  assigned_down_bus_id: busId,
});
const bus = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  capacity: z.number().int().positive(),
  hard_cap: z.number().int().positive(),
  up_trip_id: tripId,
  down_trip_id: tripId,
  driver_registration_id: z.string().uuid().nullable(),
  fixed_passenger_ids: z.array(z.string().uuid()),
  down_driver_registration_id: z.string().uuid().nullable(),
  down_fixed_passenger_ids: z.array(z.string().uuid()),
  is_cohesion_exempt: z.boolean(),
  fill_priority: z.number().int(),
  kind: z.enum(["bus", "staff_car"]),
});

export const batchSnapshotSchema = z.object({
  event_id: z.string().uuid(),
  revision: z.string().regex(/^\d+$/),
  registrations: z.array(registration),
  buses: z.array(bus),
  trips: z.array(z.object({ id: z.number().int().positive(), label: z.string() })),
});
