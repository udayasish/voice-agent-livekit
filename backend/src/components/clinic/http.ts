import type { Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError, ForbiddenError } from "../../lib/errors.js";
import { db, transactionWithHooks } from "../../lib/db/db.js";
import logger from "../../lib/logger.js";
import { requireOrganization } from "../../middlewares/organization.js";
import type { Route, ApiResponse } from "../../types.js";
import { createStaffClinicServices, type StaffClinicServices } from "./services/staff.js";
import * as s from "./contracts/staff.js";
import { emptyInputSchema } from "./contracts/inputs.js";

const organizationHeader: RequestHandler = asyncHandler(async (req, _res, next) => {
  z.uuid().parse(req.headers["x-organization-id"]); next();
});
const clinicAccess: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (req.ctx?.organization?.businessType !== "clinic") throw new ForbiddenError("Clinic access required", "CLINIC_ACCESS_DENIED"); next();
});
const clinicAdmin: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!req.ctx?.organization || req.ctx.organization.role === "member") throw new ForbiddenError("Clinic administration required", "CLINIC_ACCESS_DENIED"); next();
});
function services(req: Request) {
  const actor = req.ctx?.user; const org = req.ctx?.organization;
  if (!actor || !org) throw new ForbiddenError();
  return createStaffClinicServices({ actorId: actor.id, organizationId: org.id, role: org.role }, { db, transaction: transactionWithHooks, logger });
}
export function clinicHttpStatus(code: string): number {
  if (code === "CLINIC_ACCESS_DENIED") return 403;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "CLINIC_OPERATION_FAILED") return 500;
  if (["INVALID_CLINIC_INPUT", "INVALID_CLINIC_TIME", "INVALID_CLINIC_TIMEZONE"].includes(code)) return 400;
  return 409;
}
function send(res: Response, result: ApiResponse<unknown>, status: number) {
  if (!result.success) throw new AppError(result.error.message, clinicHttpStatus(result.error.code), result.error.code);
  const data = result.data;
  const replayed = data && typeof data === "object" && "replayed" in data && data.replayed === true;
  res.status(replayed ? 200 : status).json(result);
}
function route(method: Route["method"], path: string, admin: boolean, handler: (req: Request, service: StaffClinicServices) => Promise<ApiResponse<unknown>>, status = 200): Route {
  return { method, path, isPublic: false, middlewares: [organizationHeader, requireOrganization, clinicAccess, ...(admin ? [clinicAdmin] : [])],
    handler: asyncHandler(async (req, res) => { send(res, await handler(req, services(req)), status); }) };
}
const doctorId = (req: Request) => s.doctorParamsSchema.parse({ doctorId: req.params["doctorId"] }).doctorId;
const appointmentId = (req: Request) => s.appointmentParamsSchema.parse(req.params).appointmentId;
const key = (req: Request) => z.uuid().parse(req.headers["idempotency-key"]);
const query = <T extends z.ZodType>(schema: T, req: Request): z.output<T> => schema.parse(req.query);
// Query parsing belongs at the HTTP boundary; internal strict schemas do not coerce numeric JSON inputs.
export const clinicRoutes: Route[] = [
  route("get", "/doctors", false, (r, x) => x.listDoctors(query(s.doctorListSchema, r))),
  route("post", "/doctors", true, (r, x) => x.createDoctor(s.createDoctorSchema.parse(r.body)), 201),
  route("get", "/doctors/:doctorId", false, (r, x) => x.getDoctor(s.doctorParamsSchema.parse(r.params))),
  route("patch", "/doctors/:doctorId", true, (r, x) => x.updateDoctor(doctorId(r), s.updateDoctorSchema.parse(r.body))),
  route("get", "/doctors/:doctorId/slots", false, (r, x) => x.listSlots(doctorId(r), query(s.rangeListSchema, r))),
  route("post", "/doctors/:doctorId/slots/generate", true, (r, x) => x.generateSlots(doctorId(r), r.body)),
  route("patch", "/doctors/:doctorId/slots/:slotId", true, (r, x) => { const p = s.slotParamsSchema.parse(r.params); return x.updateSlot(p.doctorId, p.slotId, s.updateSlotSchema.parse(r.body)); }),
  route("get", "/doctors/:doctorId/available-dates", false, (r, x) => x.availableDates(doctorId(r), query(z.object({ maxDates: z.coerce.number().int().min(1).max(90).default(7) }).strict(), r))),
  route("get", "/doctors/:doctorId/available-times", false, (r, x) => x.availableTimes(doctorId(r), r.query)),
  route("get", "/doctors/:doctorId/blocked-dates", false, (r, x) => x.listBlockedDates(doctorId(r), query(s.rangeListSchema, r))),
  route("post", "/doctors/:doctorId/blocked-dates", true, (r, x) => x.blockDate(doctorId(r), r.body)),
  route("delete", "/doctors/:doctorId/blocked-dates/:blockedDateId", true, (r, x) => { emptyInputSchema.parse(r.body ?? {}); const p = s.blockParamsSchema.parse(r.params); return x.unblockDate(p.doctorId, p.blockedDateId); }),
  route("post", "/patients/resolve", false, (r, x) => x.resolvePatient(r.body)),
  route("get", "/appointments", false, (r, x) => x.listAppointments(query(s.appointmentListSchema, r))),
  route("post", "/appointments", false, (r, x) => x.book(key(r), r.body), 201),
  route("get", "/appointments/:appointmentId", false, (r, x) => x.getAppointment(s.appointmentParamsSchema.parse(r.params))),
  route("patch", "/appointments/:appointmentId", false, (r, x) => x.mutate(appointmentId(r), key(r), s.appointmentActionSchema.parse(r.body))),
];
