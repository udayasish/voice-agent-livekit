import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { before, after, test } from "node:test";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { openClinicTestDatabase, removeClinicFixtures, schema, eq } from "./clinic-test-db.js";
import { addCalendarDays, clinicLocalDate } from "../src/components/clinic/timezone.js";
import * as dto from "../src/components/clinic/contracts/staff.js";

let database: Awaited<ReturnType<typeof openClinicTestDatabase>>;
let server: Server; let base: string;
let pool: (typeof import("../src/lib/db/db.js"))["pool"];
let redis: (typeof import("../src/lib/redis.js"))["redis"];
const orgs: string[] = []; const userIds: string[] = [];
const tokens: Partial<Record<"owner" | "admin" | "member" | "outsider", string>> = {};
let organizationId: string; let otherOrg: string; let doctorId: string; let patientId: string;
let firstSlot: string; let secondSlot: string; let appointmentId: string; let tomorrow: string;
const envelope = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });

before(async () => {
  database = await openClinicTestDatabase();
  process.env["DATABASE_URL"] = database.url;
  const redisUrl = new URL(process.env["CLINIC_TEST_REDIS_URL"] ?? "redis://127.0.0.1:6380/15");
  if (!["localhost", "127.0.0.1"].includes(redisUrl.hostname) || redisUrl.pathname !== "/15") throw new Error("HTTP acceptance requires local Redis test database 15");
  process.env["REDIS_URL"] = redisUrl.toString();
  const appModule = await import("../src/app.js");
  ({ pool } = await import("../src/lib/db/db.js")); ({ redis } = await import("../src/lib/redis.js"));
  const app = new appModule.App(); server = app.app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No HTTP address"); base = `http://127.0.0.1:${address.port}/api/v1`;
  if (!redis.isReady) await once(redis, "ready");
  for (let n = 0; n < 2; n++) {
    const [org] = await database.db.insert(schema.organizations).values({ name: "Synthetic HTTP Clinic", businessType: "clinic" }).returning();
    if (!org) throw new Error("No organization"); orgs.push(org.id);
  }
  organizationId = orgs[0]!; otherOrg = orgs[1]!;
  const { hashPassword } = await import("../src/lib/password.js"); const passwordHash = await hashPassword("Phase16-test-password!");
  for (const role of ["owner", "admin", "member", "outsider"] as const) {
    const email = `${randomUUID()}@test.invalid`;
    const [user] = await database.db.insert(schema.users).values({ name: "Synthetic API Staff", email, passwordHash }).returning(); if (!user) throw new Error("No user"); userIds.push(user.id);
    await database.db.insert(schema.organizationMembers).values({ organizationId: role === "outsider" ? otherOrg : organizationId, userId: user.id, role: role === "outsider" ? "owner" : role });
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Phase16-test-password!" }) });
    assert.equal(response.status, 200); const body = envelope(z.object({ accessToken: z.string() }).passthrough()).parse(await response.json()); tokens[role] = body.data.accessToken;
  }
  tomorrow = addCalendarDays(clinicLocalDate(new Date(), "Asia/Kolkata"), 1);
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (redis?.isOpen) {
    for (const id of userIds) { for await (const key of redis.scanIterator({ MATCH: `refresh_token:${id}:*` })) await redis.del(key); }
    await redis.quit();
  }
  if (pool) await pool.end();
  if (database) { try { await removeClinicFixtures(database.db, orgs); if (userIds.length) await database.db.delete(schema.users).where(inArray(schema.users.id, userIds)); } finally { await database.pool.end(); } }
});
async function request(path: string, options: { method?: string; body?: unknown; role?: keyof typeof tokens; organization?: string; noAuth?: boolean; noOrg?: boolean; key?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!options.noAuth) headers["authorization"] = `Bearer ${tokens[options.role ?? "owner"]}`;
  if (!options.noOrg) headers["x-organization-id"] = options.organization ?? organizationId;
  if (options.key) headers["idempotency-key"] = options.key;
  const response = await fetch(`${base}${path}`, { method: options.method ?? "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const body: unknown = await response.json(); return { status: response.status, body };
}
async function expectError(path: string, status: number, options: Parameters<typeof request>[1] = {}, code?: string) {
  const r = await request(path, options); assert.equal(r.status, status, JSON.stringify(r.body));
  const body = z.object({ success: z.literal(false), error: z.object({ code: z.string(), message: z.string() }).strict() }).strict().parse(r.body);
  if (code) assert.equal(body.error.code, code); return body;
}
test("HTTP login and staff access reject missing/malformed/foreign organization context", async () => {
  await expectError("/doctors", 401, { noAuth: true }); await expectError("/doctors", 400, { noOrg: true });
  await expectError("/doctors", 400, { organization: "invalid" }); await expectError("/doctors", 403, { role: "outsider" });
  await expectError("/doctors", 403, { organization: otherOrg });
  await expectError("/doctors", 400, { method: "POST", body: { organizationId, name: "Test" } });
  await expectError("/doctors", 403, { method: "POST", role: "member", body: {} });
});
test("HTTP creates, searches, reads and partially updates a doctor", async () => {
  const r = await request("/doctors", { method: "POST", role: "admin", body: { name: "Synthetic Doctor", nameEn: "Synthetic Doctor", phoneNumber: "9000000001", searchAliases: ["Test Doctor"] } });
  assert.equal(r.status, 201, JSON.stringify(r.body)); doctorId = envelope(dto.doctorDtoSchema).parse(r.body).data.id;
  const list = await request("/doctors?search=Synthetic&page=1&pageSize=1", { role: "member" }); assert.equal(list.status, 200); assert.equal(envelope(dto.pageSchema(dto.doctorDtoSchema)).parse(list.body).data.pagination.total, 1);
  const detail = await request(`/doctors/${doctorId}`); assert.equal(detail.status, 200);
  const updated = await request(`/doctors/${doctorId}`, { method: "PATCH", body: { specialization: "General Medicine" } }); assert.equal(updated.status, 200); assert.deepEqual(envelope(dto.doctorDtoSchema).parse(updated.body).data.searchAliases, ["Test Doctor"]);
  await expectError("/doctors", 409, { method: "POST", body: { name: "Duplicate", phoneNumber: "9000000001" } }, "DOCTOR_PHONE_CONFLICT");
});
test("HTTP generates, lists and updates concrete slots and exposes actual availability", async () => {
  const generation = { weekdays: [...schema.clinicDayOfWeekEnum.enumValues], startTime: "09:00", endTime: "10:00", durationMinutes: 15, horizonDays: 4, maxPatients: 1 };
  assert.equal((await request(`/doctors/${doctorId}/slots/generate`, { method: "POST", body: generation })).status, 200);
  const repeat = await request(`/doctors/${doctorId}/slots/generate`, { method: "POST", body: generation }); assert.equal(envelope(z.object({ createdCount: z.number() })).parse(repeat.body).data.createdCount, 0);
  const slots = await request(`/doctors/${doctorId}/slots?from=${tomorrow}&to=${tomorrow}`); const items = envelope(dto.pageSchema(dto.slotDtoSchema)).parse(slots.body).data.items; assert.equal(items.length, 4);
  firstSlot = items[0]!.id; secondSlot = items[1]!.id;
  assert.equal((await request(`/doctors/${doctorId}/slots/${items[3]!.id}`, { method: "PATCH", body: { maxPatients: 2 } })).status, 200);
  const dates = await request(`/doctors/${doctorId}/available-dates?maxDates=3`); assert.equal(dates.status, 200);
  const times = await request(`/doctors/${doctorId}/available-times?date=${tomorrow}`); assert.equal(times.status, 200);
  await expectError(`/doctors/${doctorId}/available-times?date=2026-02-30`, 400);
  await expectError(`/doctors/${doctorId}/slots?from=${tomorrow}&to=${addCalendarDays(tomorrow, 90)}`, 400);
  await expectError(`/doctors/${doctorId}/slots/generate`, 403, { method: "POST", role: "member", body: generation });
});
test("HTTP resolves patients and books with mandatory request identity and honest status", async () => {
  const p = await request("/patients/resolve", { method: "POST", role: "member", body: { phoneNumber: "7000000001" } }); assert.equal(p.status, 200); patientId = envelope(z.object({ id: z.uuid() }).passthrough()).parse(p.body).data.id;
  const booking = { doctorId, patientId, slotId: firstSlot, patientName: "Synthetic Patient", patientAge: 0 };
  await expectError("/appointments", 400, { method: "POST", body: booking });
  await expectError("/appointments", 400, { method: "POST", key: randomUUID(), body: { ...booking, source: "voice" } });
  const key = randomUUID(); const booked = await request("/appointments", { method: "POST", role: "member", key, body: booking }); assert.equal(booked.status, 201, JSON.stringify(booked.body));
  appointmentId = envelope(z.object({ appointmentId: z.uuid() }).passthrough()).parse(booked.body).data.appointmentId;
  assert.match(envelope(z.object({ appointmentTime: z.string() }).passthrough()).parse(booked.body).data.appointmentTime, /^\d{2}:\d{2}$/);
  assert.equal((await request("/appointments", { method: "POST", key, body: booking })).status, 200);
  await expectError("/appointments", 409, { method: "POST", key: randomUUID(), body: booking }, "SLOT_UNAVAILABLE");
  await expectError(`/doctors/${doctorId}/blocked-dates`, 409, { method: "POST", body: { date: tomorrow } }, "DATE_HAS_BOOKINGS");
  await expectError(`/doctors/${doctorId}`, 409, { method: "PATCH", body: { isActive: false } }, "DOCTOR_HAS_BOOKINGS");
});
test("HTTP lists and reschedules, rejects stale requests, and cancels without duplicates", async () => {
  const list = await request(`/appointments?from=${tomorrow}&to=${tomorrow}&doctorId=${doctorId}`); assert.equal(list.status, 200); assert.equal(envelope(dto.pageSchema(dto.staffAppointmentSchema)).parse(list.body).data.items.length, 1);
  const key = randomUUID(); const input = { action: "reschedule", expectedVersion: 1, targetSlotId: secondSlot, reason: "Later time" };
  const move = await request(`/appointments/${appointmentId}`, { method: "PATCH", role: "member", key, body: input }); assert.equal(move.status, 200, JSON.stringify(move.body));
  assert.equal((await request(`/appointments/${appointmentId}`, { method: "PATCH", key, body: input })).status, 200);
  await expectError(`/appointments/${appointmentId}`, 409, { method: "PATCH", key: randomUUID(), body: { action: "cancel", expectedVersion: 1, reason: "Stale" } }, "APPOINTMENT_VERSION_CONFLICT");
  const details = await request(`/appointments/${appointmentId}`); const a = envelope(dto.appointmentDetailSchema).parse(details.body).data; assert.equal(a.version, 2); assert.equal(a.history.length, 1); assert.equal(a.slotId, secondSlot);
  await expectError(`/appointments/${appointmentId}`, 404, { organization: otherOrg, role: "outsider" }, "APPOINTMENT_NOT_FOUND");
  const cancelKey = randomUUID(); const cancel = { action: "cancel", expectedVersion: 2, reason: "Changed plans" };
  assert.equal((await request(`/appointments/${appointmentId}`, { method: "PATCH", key: cancelKey, body: cancel })).status, 200);
  assert.equal((await request(`/appointments/${appointmentId}`, { method: "PATCH", key: cancelKey, body: cancel })).status, 200);
});
test("HTTP blocks/lists/unblocks a cleared date and deactivates only after clearing", async () => {
  const block = await request(`/doctors/${doctorId}/blocked-dates`, { method: "POST", body: { date: tomorrow } }); assert.equal(block.status, 200);
  const blockId = envelope(z.object({ blockedDateId: z.uuid() }).passthrough()).parse(block.body).data.blockedDateId;
  assert.equal((await request(`/doctors/${doctorId}/blocked-dates?from=${tomorrow}&to=${tomorrow}`)).status, 200);
  await expectError(`/doctors/${doctorId}/blocked-dates/${blockId}`, 403, { method: "DELETE", role: "member" });
  assert.equal((await request(`/doctors/${doctorId}/blocked-dates/${blockId}`, { method: "DELETE" })).status, 200);
  assert.equal((await request(`/doctors/${doctorId}`, { method: "PATCH", body: { isActive: false } })).status, 200);
});
test("HTTP rejects suspended/non-clinic organizations and returns safe internal failures", async () => {
  await database.db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, otherOrg));
  await expectError("/doctors", 403, { role: "outsider", organization: otherOrg });
  await database.db.update(schema.organizations).set({ status: "active", businessType: "hotel" }).where(eq(schema.organizations.id, otherOrg));
  await expectError("/doctors", 403, { role: "outsider", organization: otherOrg });
  await expectError(`/doctors/${randomUUID()}`, 404);
  await expectError("/appointments?patientId=bad", 400);
});
