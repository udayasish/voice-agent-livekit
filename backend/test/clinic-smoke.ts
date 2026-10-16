import assert from "node:assert/strict";
import logger from "../src/lib/logger.js";
import { createTransactionWithHooks } from "../src/lib/db/transaction-with-hooks.js";
import { RecordingClinicScheduler } from "../src/components/clinic/notifications/recording-scheduler.js";
import { addCalendarDays, clinicLocalDate } from "../src/components/clinic/timezone.js";
import { openClinicTestDatabase, createClinicFixture, insertFixtureSlot, removeClinicFixtures } from "./clinic-test-db.js";

const database = await openClinicTestDatabase();
let organizationId: string | undefined;
try {
  const now = new Date();
  const fixture = await createClinicFixture(database.db, { now: now.toISOString() });
  organizationId = fixture.organization.id;
  const scheduler = new RecordingClinicScheduler();
  const deps = { logger, transaction: createTransactionWithHooks(database.db, logger), scheduler };
  const services = fixture.services({ source: "voice" }, deps);
  await insertFixtureSlot(database.db, fixture, { slotDate: addCalendarDays(clinicLocalDate(now, fixture.organization.timezone), 2), maxPatients: 1 });
  const doctors = await services.listActiveDoctors();
  const dates = await services.listAvailableDates({ doctorId: fixture.doctor.id });
  const patient = await services.getOrCreatePatient({ phoneNumber: "7000000000" });
  assert.ok(doctors.success && dates.success && patient.success);
  const slots = await services.listAvailableSlots({ doctorId: fixture.doctor.id, date: dates.data[0]! });
  assert.ok(slots.success);
  const booked = await services.createAppointmentFromBooking({ doctorId: fixture.doctor.id, slotId: slots.data[0]!.id, patientId: patient.data.id, patientName: "Synthetic Patient", patientAge: 24 });
  assert.ok(booked.success);
  const patientServices = fixture.services({ source: "voice", patientId: patient.data.id }, deps);
  const upcoming = await patientServices.listUpcomingAppointmentsForPatient({ patientId: patient.data.id });
  assert.ok(upcoming.success && upcoming.data.length === 1);
  const cancelled = await patientServices.cancelAppointment({ appointmentId: booked.data.appointmentId, reason: "Smoke test complete" });
  assert.ok(cancelled.success);
  const reopened = await services.listAvailableSlots({ doctorId: fixture.doctor.id, date: booked.data.appointmentDate });
  assert.ok(reopened.success && reopened.data[0]?.remainingCapacity === 1);
  console.log(JSON.stringify({ database: database.name, checks: ["doctors", "dates", "slots", "patient", "booking", "upcoming", "cancellation", "capacity reopened"], tokenNumber: booked.data.tokenNumber, scheduling: booked.data.notifications, recordedJobs: scheduler.snapshot().length, deliveredMessages: 0 }));
} finally {
  try { if (organizationId) await removeClinicFixtures(database.db, [organizationId]); }
  finally { await database.pool.end(); }
}
