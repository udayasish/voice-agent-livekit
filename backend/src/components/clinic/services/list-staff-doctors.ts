import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { doctorListSchema } from "../contracts/staff.js";
import { clinicDoctors, clinicPeople } from "../models/index.js";
import { doctorSearchKey } from "../doctor-names.js";
import type { ClinicRuntime } from "./runtime.js";
import { page } from "./staff-common.js";

export async function listStaffDoctors(runtime: ClinicRuntime, input: z.infer<typeof doctorListSchema>) {
  await runtime.requireClinic();
  // Same Unicode normalization as the existing lookup; pagination follows complete matching.
  const rows = await runtime.deps.db.select({ doctor: clinicDoctors, person: clinicPeople }).from(clinicDoctors)
    .innerJoin(clinicPeople, and(eq(clinicPeople.id, clinicDoctors.personId), eq(clinicPeople.organizationId, runtime.identity.organizationId)))
    .where(and(eq(clinicDoctors.organizationId, runtime.identity.organizationId), eq(clinicPeople.role, "doctor")))
    .orderBy(asc(clinicPeople.name), asc(clinicDoctors.id));
  const search = input.search ? doctorSearchKey(input.search) : null;
  const items = rows.filter(({ doctor, person }) => (input.active === undefined || doctor.isActive === (input.active === "true"))
    && (!search || [person.name, doctor.nameEn, doctor.nameAs, ...doctor.searchAliases].some(n => n && doctorSearchKey(n).includes(search))))
    .map(({ doctor: d, person: p }) => ({ id: d.id, personId: p.id, name: p.name ?? "", phoneNumber: p.phoneNumber,
      specialization: d.specialization, consultationDurationMinutes: d.consultationDurationMinutes, isActive: d.isActive,
      nameEn: d.nameEn, nameAs: d.nameAs, searchAliases: d.searchAliases }));
  return page(items.slice((input.page - 1) * input.pageSize, input.page * input.pageSize), items.length, { page: input.page, pageSize: input.pageSize });
}
