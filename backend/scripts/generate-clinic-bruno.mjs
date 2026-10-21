import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../bruno-collection/Clinic/", import.meta.url));
const uuid = 'bru.setVar("requestKey", require("uuid").v4());';
const makeDoctor = `const suffix = String(Date.now()).slice(-9); bru.setVar("doctorPhone", "9" + suffix); bru.setVar("patientPhone", "7" + suffix);`;
const dates = `const day = new Date(Date.now() + 86400000); const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(day); bru.setVar("clinicDate", tomorrow);`;
const booking = { doctorId: "{{doctorId}}", patientId: "{{patientId}}", slotId: "{{slotId}}", patientName: "Synthetic Bruno Patient", patientAge: 27 };
const move = { action: "reschedule", expectedVersion: "{{appointmentVersion}}", targetSlotId: "{{targetSlotId}}", reason: "Synthetic later time" };
const cancel = { action: "cancel", expectedVersion: "{{appointmentVersion}}", reason: "Synthetic cancellation" };
const definitions = [
  { folder: "Doctors", name: "Create Doctor", method: "post", url: "/doctors", status: 201, pre: makeDoctor + dates,
    body: { name: "Synthetic Bruno Doctor", phoneNumber: "{{doctorPhone}}", nameEn: "Synthetic Bruno Doctor", specialization: "General Medicine", searchAliases: ["Bruno Doctor"] }, post: 'bru.setVar("doctorId", res.body.data.id);' },
  { folder: "Doctors", name: "List Doctors", method: "get", url: "/doctors?page=1&pageSize=20&active=true", status: 200 },
  { folder: "Doctors", name: "Get Doctor", method: "get", url: "/doctors/{{doctorId}}", status: 200 },
  { folder: "Doctors", name: "Update Doctor", method: "patch", url: "/doctors/{{doctorId}}", status: 200, body: { specialization: "General Medicine", consultationDurationMinutes: 15 } },
  { folder: "Schedules", name: "Generate Slots", method: "post", url: "/doctors/{{doctorId}}/slots/generate", status: 200,
    body: { weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"], startTime: "09:00", endTime: "10:00", durationMinutes: 15, horizonDays: 4, maxPatients: 1 } },
  { folder: "Schedules", name: "List Slots", method: "get", url: "/doctors/{{doctorId}}/slots?from={{clinicDate}}&to={{clinicDate}}&pageSize=20", status: 200,
    post: 'const slots = res.body.data.items; bru.setVar("slotId", slots[0].id); bru.setVar("targetSlotId", slots[1].id); bru.setVar("emptySlotId", slots[3].id);' },
  { folder: "Schedules", name: "Update Slot", method: "patch", url: "/doctors/{{doctorId}}/slots/{{emptySlotId}}", status: 200, body: { maxPatients: 2 } },
  { folder: "Schedules", name: "Available Dates", method: "get", url: "/doctors/{{doctorId}}/available-dates?maxDates=7", status: 200 },
  { folder: "Schedules", name: "Available Times", method: "get", url: "/doctors/{{doctorId}}/available-times?date={{clinicDate}}", status: 200 },
  { folder: "Patients", name: "Resolve Patient", method: "post", url: "/patients/resolve", status: 200, body: { phoneNumber: "{{patientPhone}}" }, post: 'bru.setVar("patientId", res.body.data.id);' },
  { folder: "Appointments", name: "Book Appointment", method: "post", url: "/appointments", status: 201, pre: uuid, key: "{{requestKey}}", body: booking,
    post: 'bru.setVar("appointmentId", res.body.data.appointmentId); bru.setVar("appointmentVersion", res.body.data.version); bru.setVar("bookingKey", bru.getVar("requestKey"));' },
  { folder: "Appointments", name: "List Appointments", method: "get", url: "/appointments?from={{clinicDate}}&to={{clinicDate}}&doctorId={{doctorId}}", status: 200 },
  { folder: "Appointments", name: "Get Appointment", method: "get", url: "/appointments/{{appointmentId}}", status: 200, post: 'bru.setVar("appointmentVersion", res.body.data.version);' },
  { folder: "Appointments", name: "Reschedule Appointment", method: "patch", url: "/appointments/{{appointmentId}}", status: 200, pre: uuid, key: "{{requestKey}}", body: move,
    post: 'bru.setVar("moveKey", bru.getVar("requestKey")); bru.setVar("moveExpectedVersion", res.body.data.version - 1); bru.setVar("appointmentVersion", res.body.data.version);' },
  { folder: "Appointments", name: "Cancel Appointment", method: "patch", url: "/appointments/{{appointmentId}}", status: 200, pre: uuid, key: "{{requestKey}}", body: cancel, post: 'bru.setVar("appointmentVersion", res.body.data.version);' },
  { folder: "Schedules", name: "Block Cleared Date", method: "post", url: "/doctors/{{doctorId}}/blocked-dates", status: 200, body: { date: "{{clinicDate}}", reason: "leave" }, post: 'bru.setVar("blockedDateId", res.body.data.blockedDateId);' },
  { folder: "Schedules", name: "List Blocked Dates", method: "get", url: "/doctors/{{doctorId}}/blocked-dates?from={{clinicDate}}&to={{clinicDate}}", status: 200 },
  { folder: "Schedules", name: "Unblock Date", method: "delete", url: "/doctors/{{doctorId}}/blocked-dates/{{blockedDateId}}", status: 200 },
];
const failures = [
  { name: "Reject Unauthorized", method: "get", url: "/doctors", status: 401, auth: "none" },
  { name: "Reject Foreign Organization", method: "get", url: "/doctors", status: 403, org: "{{otherOrganizationId}}" },
  { name: "Reject Member Doctor Edit", method: "patch", url: "/doctors/{{doctorId}}", status: 403, token: "{{memberAccessToken}}", body: { specialization: "Forbidden" } },
  { name: "Reject Invalid Date", method: "get", url: "/doctors/{{doctorId}}/available-times?date=2026-02-30", status: 400 },
  { name: "Reject Full Slot", method: "post", url: "/appointments", status: 409, pre: uuid, key: "{{requestKey}}", body: booking },
  { name: "Reject Conflicting Booking Key", method: "post", url: "/appointments", status: 409, key: "{{bookingKey}}", body: { ...booking, patientAge: 28 } },
  { name: "Reject Block With Bookings", method: "post", url: "/doctors/{{doctorId}}/blocked-dates", status: 409, body: { date: "{{clinicDate}}" } },
  { name: "Reject Deactivation With Bookings", method: "patch", url: "/doctors/{{doctorId}}", status: 409, body: { isActive: false } },
  { name: "Reject Cross Doctor Move", method: "patch", url: "/appointments/{{appointmentId}}", status: 409, pre: uuid, key: "{{requestKey}}", body: { ...move, targetSlotId: "{{otherDoctorSlotId}}" } },
  { name: "Reject Stale Version", method: "patch", url: "/appointments/{{appointmentId}}", status: 409, pre: uuid, key: "{{requestKey}}", body: { ...cancel, expectedVersion: 1 } },
];
function content(d, seq) {
  const json = d.body === undefined ? "" : JSON.stringify(d.body, null, 2).replace(/"(\{\{(?:appointmentVersion|moveExpectedVersion)\}\})"/g, "$1");
  return `meta {\n  name: ${d.name}\n  type: http\n  seq: ${seq}\n}\n\n${d.method} {\n  url: {{host}}/api/v1${d.url}\n  body: ${d.body === undefined ? "none" : "json"}\n  auth: ${d.auth ?? "bearer"}\n}\n\nheaders {\n  x-organization-id: ${d.org ?? "{{organizationId}}"}\n${d.key ? `  Idempotency-Key: ${d.key}\n` : ""}}\n\n${d.auth === "none" ? "" : `auth:bearer {\n  token: ${d.token ?? "{{accessToken}}"}\n}\n\n`}${d.body === undefined ? "" : `body:json {\n${json.split("\n").map(l => "  " + l).join("\n")}\n}\n\n`}${d.pre ? `script:pre-request {\n  ${d.pre}\n}\n\n` : ""}script:post-response {\n  if (res.status === ${d.status} && res.body.success) { ${d.post ?? ""} }\n}\n\ntests {\n  test("Expected HTTP status", function () { expect(res.status).to.equal(${d.status}); });\n  test("Standard envelope", function () { expect(res.body.success).to.equal(${d.status < 400}); ${d.status < 400 ? 'expect(res.body).to.have.property("data");' : 'expect(res.body.error.code).to.be.a("string"); expect(res.body.error.message).to.be.a("string");'} });\n${d.assert ? `  test("Business result", function () { ${d.assert} });\n` : ""}}\n\ndocs {\n  Synthetic local clinic data only. See Clinic/README.md for prerequisites and ordered acceptance.\n}\n`;
}
async function save(folder, d, seq) { await mkdir(path.join(root, folder), { recursive: true }); await writeFile(path.join(root, folder, `${String(seq).padStart(2, "0")} ${d.name}.bru`), content(d, seq)); }
for (let n = 0; n < definitions.length; n++) await save(definitions[n].folder, definitions[n], n + 1);
for (let n = 0; n < failures.length; n++) await save("Failure Cases", failures[n], n + 1);

const login = { name: "Login Staff", method: "post", url: "/auth/login", status: 200, auth: "none", body: { email: "{{adminEmail}}", password: "{{adminPassword}}" }, post: 'bru.setVar("accessToken", res.body.data.accessToken); bru.setVar("organizationId", res.body.data.currentOrganization.id);' };
const lookup = name => definitions.find(d => d.name === name);
const fail = name => failures.find(d => d.name === name);
const acceptance = [login, ...failures.slice(0, 2), lookup("Create Doctor"), lookup("List Doctors"), lookup("Get Doctor"), lookup("Update Doctor"),
  fail("Reject Member Doctor Edit"), fail("Reject Invalid Date"), lookup("Generate Slots"), lookup("List Slots"), lookup("Update Slot"), lookup("Available Dates"), lookup("Available Times"), lookup("Resolve Patient"), lookup("Book Appointment"),
  { ...lookup("Book Appointment"), name: "Replay Booking", status: 200, pre: undefined, key: "{{bookingKey}}", post: undefined, assert: 'expect(res.body.data.replayed).to.equal(true);' },
  fail("Reject Full Slot"), fail("Reject Conflicting Booking Key"), fail("Reject Block With Bookings"), fail("Reject Deactivation With Bookings"),
  { name: "Create Other Doctor", method: "post", url: "/doctors", status: 201, pre: 'bru.setVar("otherDoctorPhone", "8" + String(Date.now()).slice(-9));', body: { name: "Other Synthetic Doctor", phoneNumber: "{{otherDoctorPhone}}" }, post: 'bru.setVar("otherDoctorId", res.body.data.id);' },
  { ...lookup("Generate Slots"), name: "Generate Other Doctor Slots", url: "/doctors/{{otherDoctorId}}/slots/generate" },
  { ...lookup("List Slots"), name: "List Other Doctor Slots", url: "/doctors/{{otherDoctorId}}/slots?from={{clinicDate}}&to={{clinicDate}}", post: 'bru.setVar("otherDoctorSlotId", res.body.data.items[0].id);' },
  fail("Reject Cross Doctor Move"), lookup("List Appointments"), lookup("Get Appointment"), lookup("Reschedule Appointment"),
  { ...lookup("Reschedule Appointment"), name: "Replay Move", pre: undefined, key: "{{moveKey}}", body: { ...move, expectedVersion: "{{moveExpectedVersion}}" }, post: undefined, assert: 'expect(res.body.data.replayed).to.equal(true);' },
  fail("Reject Stale Version"),
  { ...lookup("List Slots"), name: "Verify Old And New Capacity", post: undefined, assert: 'const rows = res.body.data.items; expect(rows.find(s => s.id === bru.getVar("slotId")).remainingCapacity).to.equal(1); expect(rows.find(s => s.id === bru.getVar("targetSlotId")).remainingCapacity).to.equal(0);' },
  lookup("Cancel Appointment"), lookup("Block Cleared Date"), lookup("List Blocked Dates"), lookup("Unblock Date"),
];
for (let n = 0; n < acceptance.length; n++) await save("Acceptance", acceptance[n], n + 1);
console.log(`Generated ${definitions.length + failures.length + acceptance.length} Bruno requests.`);
