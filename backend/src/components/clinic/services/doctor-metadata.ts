import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { clinicDoctors, clinicPeople } from "../models/index.js";
import { doctorSearchKey } from "../doctor-names.js";
import { ClinicRuntime, type ClinicDependencies } from "./runtime.js";
import { clinicError } from "../contracts/errors.js";

const text = z.string().trim().min(1).max(255);
export const doctorMetadataSchema = z.object({ doctorId: z.uuid(), nameEn: text.refine(value => /\p{Script=Latin}/u.test(value)
  && !/[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Zs}]/u.test(value), "Use a reviewed English spelling"),
  nameAs: text.nullable(), searchAliases: z.array(text).max(50),
}).strict().superRefine((value, ctx) => {
  const keys = value.searchAliases.map(doctorSearchKey);
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["searchAliases"], message: "Aliases must have distinct normalized names" });
});
export const doctorMetadataImportSchema = z.object({ organizationId: z.uuid(), doctors: z.array(doctorMetadataSchema).min(1).max(500) }).strict()
  .refine(value => new Set(value.doctors.map(d => d.doctorId)).size === value.doctors.length, "Duplicate doctor identity");

/** Internal operator utility, never exposed as a model tool. Validate all rows before any write. */
export async function importDoctorMetadata(input: unknown, deps: ClinicDependencies, dryRun = true) {
  const parsed = doctorMetadataImportSchema.parse(input);
  const runtime = new ClinicRuntime({ organizationId: parsed.organizationId, source: "manual" }, deps);
  await deps.transaction(async tx => {
    await runtime.requireClinic(tx, true);
    for (const doctor of parsed.doctors) {
      await runtime.requireDoctor(doctor.doctorId, tx, false);
      if (!dryRun) {
        const { doctorId, ...values } = doctor;
        await tx.update(clinicDoctors).set(values).where(and(eq(clinicDoctors.id, doctorId), eq(clinicDoctors.organizationId, parsed.organizationId)));
      }
    }
  });
  return { dryRun, reviewedDoctors: parsed.doctors.length };
}

export async function doctorMetadataReadiness(organizationId: string, deps: ClinicDependencies) {
  const runtime = new ClinicRuntime({ organizationId, source: "manual" }, deps);
  await runtime.requireClinic();
  const rows = await deps.db.select({ doctorId: clinicDoctors.id, nameEn: clinicDoctors.nameEn }).from(clinicDoctors)
    .innerJoin(clinicPeople, and(eq(clinicDoctors.personId, clinicPeople.id), eq(clinicPeople.organizationId, organizationId)))
    .where(and(eq(clinicDoctors.organizationId, organizationId), eq(clinicPeople.role, "doctor")));
  if (rows.some(row => row.nameEn !== null && !row.nameEn.trim())) clinicError("INVALID_CLINIC_INPUT");
  return { total: rows.length, missingEnglishNames: rows.filter(row => !row.nameEn).map(row => row.doctorId) };
}
