import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as inputs from "../src/components/clinic/contracts/inputs.js";
import { ClinicServiceError } from "../src/components/clinic/contracts/errors.js";
import { createClinicServices, type ClinicDependencies } from "../src/components/clinic/index.js";
import { clinicLocalDate, addCalendarDays, zonedTimeToUtc } from "../src/components/clinic/timezone.js";
import { scheduleReminder } from "../src/components/clinic/notifications/schedule-reminder.js";
import { scheduleBookingAlert } from "../src/components/clinic/notifications/schedule-booking-alert.js";
import { RecordingClinicScheduler } from "../src/components/clinic/notifications/recording-scheduler.js";
import type { Database } from "../src/lib/db/transaction-with-hooks.js";

const ids = { organizationId: randomUUID(), doctorId: randomUUID(), patientId: randomUUID(), slotId: randomUUID() };
const logs: { message: string; metadata: Record<string, unknown> }[] = [];
const logger = {
  info: (message: string, metadata: Record<string, unknown>) => logs.push({ message, metadata }),
  warn: (message: string, metadata: Record<string, unknown>) => logs.push({ message, metadata }),
  error: (message: string, metadata: Record<string, unknown>) => logs.push({ message, metadata }),
};
const deps: ClinicDependencies = { db: {} as Database, transaction: async () => { throw new Error("private patient/credential payload"); }, logger };
const booking = { doctorId: ids.doctorId, patientId: ids.patientId, slotId: ids.slotId, patientName: "Synthetic Patient", patientAge: 0 };

test("typed booking retains explicitly supplied age zero and optional complaint", () => {
  assert.equal(inputs.bookingInputSchema.parse(booking).patientAge, 0);
  assert.equal(inputs.bookingInputSchema.safeParse({ ...booking, patientAge: undefined }).success, false);
  for (const age of [-1, 121, 1.5]) assert.equal(inputs.bookingInputSchema.safeParse({ ...booking, patientAge: age }).success, false);
});

test("operation schemas reject context/date/time spoofing and unexpected fields", () => {
  for (const field of ["organizationId", "source", "callId", "appointmentDate", "appointmentTime", "existingUser", "context"]) {
    assert.equal(inputs.bookingInputSchema.safeParse({ ...booking, [field]: "spoofed" }).success, false);
  }
  assert.equal(inputs.cancelInputSchema.safeParse({ appointmentId: randomUUID(), reason: "Changed plans", slotId: ids.slotId, patientId: ids.patientId }).success, false);
});

test("real calendar dates and slot-generation limits are validated", () => {
  assert.equal(inputs.dateSchema.safeParse("2026-02-30").success, false);
  assert.equal(inputs.dateSchema.safeParse("2028-02-29").success, true);
  const valid = { doctorId: ids.doctorId, weekdays: ["monday"], startTime: "09:00", endTime: "10:00", durationMinutes: 15, horizonDays: 7 };
  assert.equal(inputs.generateSlotsInputSchema.parse(valid).maxPatients, 30);
  for (const changes of [{ durationMinutes: 0 }, { horizonDays: 0 }, { endTime: "08:00" }, { startTime: "25:00" }, { maxPatients: 0 }]) {
    assert.equal(inputs.generateSlotsInputSchema.safeParse({ ...valid, ...changes }).success, false);
  }
});

test("phone input preserves supplied digits and does not infer missing digits/country", () => {
  assert.equal(inputs.patientInputSchema.parse({ phoneNumber: "+917002059544" }).phoneNumber, "917002059544");
  assert.equal(inputs.patientInputSchema.parse({ phoneNumber: "7002059544" }).phoneNumber, "7002059544");
  for (const phoneNumber of ["700205954", "seven double zero", "700 205 9544", "7002059544abc"]) {
    assert.equal(inputs.patientInputSchema.safeParse({ phoneNumber }).success, false);
  }
});

test("service identity is copied/frozen and malformed identity fails safely", async () => {
  const identity = { organizationId: ids.organizationId, source: "voice" as const };
  const services = createClinicServices(identity, deps);
  identity.organizationId = randomUUID();
  logs.length = 0;
  await services.listActiveDoctors();
  assert.equal(logs[0]?.metadata["organizationId"], ids.organizationId);
  assert.equal(Object.isFrozen(services), true);
  assert.throws(() => createClinicServices({ organizationId: "invalid", source: "voice" }, deps), ClinicServiceError);
});

test("invalid inputs are rejected before database access; failures never reveal payloads", async () => {
  logs.length = 0;
  const services = createClinicServices({ organizationId: ids.organizationId, source: "voice" }, deps);
  const invalid = await services.createAppointmentFromBooking({ ...booking, organizationId: randomUUID() } as never);
  assert.deepEqual(invalid, { success: false, error: { code: "INVALID_CLINIC_INPUT", message: "The clinic request is invalid." } });
  const failure = await services.getOrCreatePatient({ phoneNumber: "7002059544" });
  assert.deepEqual(failure, { success: false, error: { code: "CLINIC_OPERATION_FAILED", message: "The clinic operation could not be completed." } });
  const serialized = JSON.stringify(logs);
  for (const sensitive of ["7002059544", "Synthetic Patient", "credential", "payload", "stack"]) assert.equal(serialized.includes(sensitive), false);
});

test("clinic-local dates and calendar arithmetic ignore host/UTC date boundaries", () => {
  const instant = new Date("2026-10-13T02:00:00Z");
  assert.equal(clinicLocalDate(instant, "America/Los_Angeles"), "2026-10-12");
  assert.equal(clinicLocalDate(instant, "Asia/Kolkata"), "2026-10-13");
  assert.equal(addCalendarDays("2028-02-28", 2), "2028-03-01");
  assert.equal(zonedTimeToUtc("2026-10-15", "09:00", "Asia/Kolkata").toISOString(), "2026-10-15T03:30:00.000Z");
});

test("timezone conversion supports seasonal offsets and rejects DST gap/overlap", () => {
  assert.equal(zonedTimeToUtc("2026-07-15", "09:00", "America/New_York").toISOString(), "2026-07-15T13:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-01-15", "09:00", "America/New_York").toISOString(), "2026-01-15T14:00:00.000Z");
  assert.throws(() => zonedTimeToUtc("2026-03-08", "02:30", "America/New_York"), RangeError);
  assert.throws(() => zonedTimeToUtc("2026-11-01", "01:30", "America/New_York"), RangeError);
  assert.throws(() => zonedTimeToUtc("2026-02-30", "09:00", "Asia/Kolkata"), RangeError);
});

test("reminders keep source 24-hour timing; alerts are immediate and settings are honored", async () => {
  const appointment = { id: randomUUID(), organizationId: ids.organizationId, appointmentDate: "2026-10-15", appointmentTime: "09:00:00" };
  const scheduler = new RecordingClinicScheduler();
  const notificationDeps = { now: () => new Date("2026-10-13T00:00:00Z"), logger, scheduler };
  assert.equal(await scheduleReminder(appointment, "Asia/Kolkata", true, notificationDeps), "scheduled");
  assert.equal(await scheduleBookingAlert(appointment, true, notificationDeps), "scheduled");
  assert.equal(scheduler.snapshot()[0]?.runAt, "2026-10-14T03:30:00.000Z");
  assert.equal(scheduler.snapshot()[1]?.runAt, "2026-10-13T00:00:00.000Z");
  assert.equal(await scheduleReminder(appointment, "Asia/Kolkata", false, notificationDeps), "disabled");
  assert.equal(await scheduleBookingAlert(appointment, false, notificationDeps), "disabled");
  assert.equal(scheduler.snapshot().length, 2);
});

test("elapsed reminder windows and absent delivery adapters are reported honestly", async () => {
  const appointment = { id: randomUUID(), organizationId: ids.organizationId, appointmentDate: "2026-10-15", appointmentTime: "09:00:00" };
  assert.equal(await scheduleReminder(appointment, "Asia/Kolkata", true, { now: () => new Date("2026-10-14T03:30:00Z"), logger }), "skipped_window");
  assert.equal(await scheduleReminder(appointment, "Asia/Kolkata", true, { now: () => new Date("2026-10-13T00:00:00Z"), logger }), "unconfigured");
  assert.equal(await scheduleBookingAlert(appointment, true, { now: () => new Date(), logger }), "unconfigured");
});

test("source inventory classifies every source module and preserves adoption hashes", () => {
  const inventory = JSON.parse(readFileSync(new URL("./fixtures/clinic-source-inventory.json", import.meta.url), "utf8")) as { files: { path: string; classification: string; sha256: string }[] };
  assert.equal(inventory.files.filter((file) => file.path.startsWith("src/") && file.path.endsWith(".ts")).length, 159);
  assert.equal(inventory.files.filter((file) => file.classification === "adapted").length, 20);
  assert.equal(new Set(inventory.files.map((file) => file.path)).size, inventory.files.length);
  for (const file of inventory.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(["adapted", "reused", "excluded"].includes(file.classification));
  }
});

test("clinic domain imports no source repository, agent engine, WhatsApp transport or SQL client", () => {
  const root = fileURLToPath(new URL("../src/components/clinic/", import.meta.url));
  function inspect(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "voice") inspect(path); }
      else if (entry.name.endsWith(".ts")) {
        const content = readFileSync(path, "utf8");
        const imports = [...content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1]!);
        for (const imported of imports) {
          assert.doesNotMatch(imported, /whatsapp-appointment-platform|\/agent\/|\/whatsapp\/|bullmq|ioredis|^pg$|env\.js|livekit/);
        }
      }
    }
  }
  inspect(root);
});
