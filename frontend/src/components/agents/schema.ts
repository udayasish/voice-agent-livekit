import { z } from "zod";
export const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const text = (max: number, bytes: number, min = 0) => z.string().trim().refine(v => [...v].length >= min && [...v].length <= max, `Use ${min}–${max} characters`)
  .refine(v => new TextEncoder().encode(v).length <= bytes, "Text is too large").refine(v => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(v), "Invalid control character");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const interval = z.object({ start: time, end: z.union([time, z.literal("24:00")]) }).strict().refine(v => v.start < v.end, "Split overnight hours across two days");
const day = z.array(interval).max(4).refine(v => { const s = [...v].sort((a,b) => a.start.localeCompare(b.start)); return s.every((x,i) => !i || x.start >= s[i-1]!.end); }, "Intervals overlap");
export const formSchema = z.object({ name: text(100,400,1), isActive: z.boolean(), instructions: text(1000,2000), greeting: text(300,900),
  languages: z.array(z.enum(["as","hi","en"])).min(1).max(3), defaultLanguage: z.enum(["as","hi","en"]), enabledTools: z.array(z.string()),
  workingHours: z.discriminatedUnion("mode", [z.object({mode:z.literal("always_open")}).strict(),z.object({mode:z.literal("weekly"),days:z.object({monday:day,tuesday:day,wednesday:day,thursday:day,friday:day,saturday:day,sunday:day}).strict()}).strict()]),
  humanContact: z.discriminatedUnion("mode", [z.object({mode:z.literal("disabled")}).strict(),z.object({mode:z.literal("contact_only"),label:text(100,400,1),phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/u,"Use + and the full international number")}).strict()]),
}).strict().superRefine((v,ctx)=>{
  if(!v.languages.includes(v.defaultLanguage))ctx.addIssue({code:"custom",path:["defaultLanguage"],message:"Select this language above first"});
  if(new Set(v.languages).size!==v.languages.length||new Set(v.enabledTools).size!==v.enabledTools.length)ctx.addIssue({code:"custom",message:"Duplicate selection"});
  const values=[v.name,v.instructions,v.greeting,...(v.humanContact.mode==='contact_only'?[v.humanContact.label,v.humanContact.phoneNumber]:[])];
  if(new TextEncoder().encode(values.join('')).length>3072)ctx.addIssue({code:"custom",message:"Combined text is too large"});
});
export type AgentFormValues=z.infer<typeof formSchema>;
export const emptyWeek=(): Record<typeof days[number],Array<{start:string;end:string}>> => ({monday:[],tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[]});
