import { z } from "zod";
import { agentConfigSchema, languageSchema } from "../engine/config.js";
import { clinicToolNames } from "../../clinic/voice/names.js";

export const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const text = (max: number, bytes: number, min = 0) => z.string().trim().refine(v => [...v].length >= min && [...v].length <= max, `Use ${min}–${max} characters`)
  .refine(v => Buffer.byteLength(v, "utf8") <= bytes, "Text is too large")
  .refine(v => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(v), "Control characters are not allowed");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const interval = z.object({ start: time, end: z.union([time, z.literal("24:00")]) }).strict().refine(v => v.start < v.end, "End must be after start; split overnight hours");
const day = z.array(interval).max(4).superRefine((v, ctx) => {
  const sorted = [...v].sort((a, b) => a.start.localeCompare(b.start));
  if (sorted.some((x, i) => i > 0 && x.start < sorted[i - 1]!.end)) ctx.addIssue({ code: "custom", message: "Opening intervals overlap" });
}).transform(v => [...v].sort((a, b) => a.start.localeCompare(b.start)));
export const hoursSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("always_open") }).strict(),
  z.object({ mode: z.literal("weekly"), days: z.object({ monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day }).strict() }).strict()]);
export const contactSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("disabled") }).strict(),
  z.object({ mode: z.literal("contact_only"), label: text(100, 400, 1), phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/u) }).strict()]);
export const editableObject = z.object({ name: text(100, 400, 1), isActive: z.boolean().default(true), instructions: text(1000, 2000).default(""),
  greeting: text(300, 900).default(""), languages: z.array(languageSchema).min(1).max(3).default(["as"]), defaultLanguage: languageSchema.default("as"),
  enabledTools: z.array(z.enum(clinicToolNames)).max(8).default([]), workingHours: hoursSchema.default({ mode: "always_open" }), humanContact: contactSchema.default({ mode: "disabled" }) }).strict();
export const editableSchema = editableObject.superRefine((v, ctx) => {
  if (!v.languages.includes(v.defaultLanguage)) ctx.addIssue({ code: "custom", path: ["defaultLanguage"], message: "Default language must be selected" });
  if (new Set(v.languages).size !== v.languages.length || new Set(v.enabledTools).size !== v.enabledTools.length) ctx.addIssue({ code: "custom", message: "Duplicate languages or tools" });
  const strings = [v.name, v.instructions, v.greeting, ...(v.humanContact.mode === "contact_only" ? [v.humanContact.label, v.humanContact.phoneNumber] : [])];
  if (Buffer.byteLength(strings.join(""), "utf8") > 3072) ctx.addIssue({ code: "custom", message: "Combined editable text exceeds 3072 bytes" });
});
export const updateSchema = editableObject.partial().extend({ expectedVersion: z.number().int().positive() }).strict()
  .refine(v => Object.keys(v).length > 1, "Provide at least one setting");
export const listSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(), active: z.enum(["true", "false"]).optional() }).strict();
export const readParams = z.object({ agentId: z.string().min(1).max(100) }).strict();
export const updateParams = z.object({ agentId: z.uuid() }).strict();
export const snapshotSchema = editableSchema.safeExtend({ organizationId: z.uuid(), agentId: z.uuid(), version: z.number().int().positive(),
  business: z.enum(["clinic", "generic"]), appointmentsEnabled: z.boolean(), timezone: z.string().min(1), businessName: z.string().min(1),
  contextLimits: agentConfigSchema.shape.contextLimits.unwrap().optional() });
export type AgentSettings = z.infer<typeof editableSchema>;
export type AgentSnapshot = z.infer<typeof snapshotSchema>;
export type WorkingHours = z.infer<typeof hoursSchema>;

export const toolDependencies: Record<string, readonly string[]> = {
  book_appointment: ["resolve_clinic_and_caller", "list_doctors", "find_doctor", "get_available_dates", "get_available_times"],
  check_my_appointments: ["resolve_clinic_and_caller"], cancel_appointment: ["check_my_appointments"],
};
export function toolPolicyError(tools: readonly string[], business: string, appointmentsEnabled: boolean): string | undefined {
  if (tools.length && (business !== "clinic" || !appointmentsEnabled)) return "Clinic tools are not available for this agent";
  const discovery = tools.includes("list_doctors") || tools.includes("find_doctor");
  for (const key of tools) {
    const missing = (toolDependencies[key] ?? []).filter(dep => !tools.includes(dep));
    if (missing.length) return `${key} requires ${missing.join(", ")}`;
    if (["get_available_dates", "get_available_times", "check_my_appointments"].includes(key) && !discovery) return `${key} requires list_doctors or find_doctor`;
  }
  return undefined;
}
