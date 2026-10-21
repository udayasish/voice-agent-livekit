import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, RunTransaction, Transaction } from "../../../lib/db/transaction-with-hooks.js";
import { organizations } from "../../../lib/db/models/organizations.js";
import { errorResponse, successResponse } from "../../../lib/response.js";
import { clinicIdentitySchema, type ClinicIdentity } from "../contracts/inputs.js";
import { clinicError, ClinicServiceError } from "../contracts/errors.js";
import type { ClinicResult } from "../contracts/results.js";
import { clinicDoctors, clinicPeople, clinicSettings } from "../models/index.js";
import type { ClinicLogger, ClinicNotificationScheduler } from "../notifications/types.js";
import { clinicLocalDate, zonedTimeToUtc } from "../timezone.js";

export interface ClinicDependencies {
  readonly db: Database;
  readonly transaction: RunTransaction;
  readonly logger: ClinicLogger;
  readonly now?: () => Date;
  readonly scheduler?: ClinicNotificationScheduler;
}
export type ClinicConnection = Database | Transaction;

export class ClinicRuntime {
  readonly identity: ClinicIdentity;
  readonly now: () => Date;
  constructor(identity: ClinicIdentity, readonly deps: ClinicDependencies) {
    const parsed = clinicIdentitySchema.safeParse(identity);
    if (!parsed.success) clinicError("INVALID_CLINIC_INPUT");
    this.identity = Object.freeze({ ...parsed.data });
    this.now = deps.now ?? (() => new Date());
  }

  async run<I, O>(operation: string, input: unknown, inputSchema: z.ZodType<I>, outputSchema: z.ZodType<O>, fn: (value: I) => Promise<O>): Promise<ClinicResult<O>> {
    const started = performance.now();
    const metadata = { organizationId: this.identity.organizationId, operation };
    this.deps.logger.info("Clinic operation started", metadata);
    try {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) clinicError("INVALID_CLINIC_INPUT");
      const value = outputSchema.parse(await fn(parsed.data));
      // Schemas contain JSON primitives only; never return ORM records or Date instances.
      this.deps.logger.info("Clinic operation completed", { ...metadata, durationMs: performance.now() - started });
      return successResponse(value);
    } catch (error) {
      const safe = error instanceof ClinicServiceError ? error : new ClinicServiceError("CLINIC_OPERATION_FAILED");
      this.deps.logger.warn("Clinic operation failed", { ...metadata, errorCode: safe.code, durationMs: performance.now() - started });
      return errorResponse(safe.code, safe.message);
    }
  }

  async requireClinic(connection: ClinicConnection = this.deps.db, lock = false) {
    const query = connection.select({ organization: organizations, settings: clinicSettings })
      .from(organizations).leftJoin(clinicSettings, eq(clinicSettings.organizationId, organizations.id))
      .where(eq(organizations.id, this.identity.organizationId));
    const [row] = await (lock ? query.for("share", { of: organizations }) : query);
    if (!row) clinicError("CLINIC_NOT_FOUND");
    if (row.organization.status !== "active" || row.organization.businessType !== "clinic") clinicError("CLINIC_UNAVAILABLE");
    try { clinicLocalDate(this.now(), row.organization.timezone); }
    catch { clinicError("INVALID_CLINIC_TIMEZONE"); }
    return {
      organizationId: row.organization.id, name: row.organization.name, timezone: row.organization.timezone,
      remindersEnabled: row.settings?.remindersEnabled ?? true,
      notificationsEnabled: row.settings?.notificationsEnabled ?? true,
    };
  }

  async requireDoctor(doctorId: string, connection: ClinicConnection = this.deps.db, active = true) {
    const query = connection.select({ id: clinicDoctors.id, isActive: clinicDoctors.isActive })
      .from(clinicDoctors).innerJoin(clinicPeople, and(eq(clinicDoctors.personId, clinicPeople.id), eq(clinicPeople.organizationId, this.identity.organizationId)))
      .where(and(eq(clinicDoctors.id, doctorId), eq(clinicDoctors.organizationId, this.identity.organizationId), eq(clinicPeople.role, "doctor")));
    const [doctor] = await (connection === this.deps.db ? query : query.for("share", { of: clinicDoctors }));
    if (!doctor) clinicError("DOCTOR_NOT_FOUND");
    if (active && !doctor.isActive) clinicError("DOCTOR_INACTIVE");
    return doctor;
  }

  async requirePatient(patientId: string, connection: ClinicConnection = this.deps.db) {
    if (this.identity.patientId && this.identity.patientId !== patientId) clinicError("CLINIC_ACCESS_DENIED");
    const query = connection.select().from(clinicPeople)
      .where(and(eq(clinicPeople.id, patientId), eq(clinicPeople.organizationId, this.identity.organizationId)));
    const [patient] = await (connection === this.deps.db ? query : query.for("share"));
    if (!patient) clinicError("PATIENT_NOT_FOUND");
    if (patient.role !== "patient") clinicError("PATIENT_ROLE_CONFLICT");
    return patient;
  }

  requireOperator(): void { if (this.identity.patientId) clinicError("CLINIC_ACCESS_DENIED"); }

  async lockDoctorDate(connection: Transaction, doctorId: string, date: string): Promise<void> {
    // Preserve the source doctor's day lock (UUIDs identify doctors globally within this DB).
    const key = `${doctorId}:${date}`;
    await connection.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  }

  appointmentInstant(date: string, time: string, timezone: string): Date {
    try { return zonedTimeToUtc(date, time, timezone); }
    catch { return clinicError("INVALID_CLINIC_TIME"); }
  }
}
