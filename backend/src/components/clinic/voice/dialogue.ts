import { z } from "zod";
import { doctorMatchSchema, slotSummarySchema } from "../contracts/results.js";
import { dateSchema } from "../contracts/inputs.js";
import { doctorName, doctorSearchKey } from "../doctor-names.js";
import { calendarDate, spokenDate, spokenTime, calendarRequest, offeredDateChoice, type CalendarRequest } from "./calendar.js";
import type { AgentLanguage, TurnOptions } from "../../agent/engine/index.js";

export const voiceDoctorSchema = doctorMatchSchema;
export type VoiceDoctor = z.infer<typeof voiceDoctorSchema>;
export const readOutcomeSchema = z.enum(["listed", "matched", "ambiguous", "not_found", "inactive", "dates_available", "times_available", "no_availability", "service_error", "disabled"]);
export const readStateSchema = z.object({
  candidates: z.array(voiceDoctorSchema), selectedDoctor: voiceDoctorSchema.nullable(), selectedDate: dateSchema.nullable(),
  question: z.enum(["doctor", "date", "time", "ampm", "patient", "none"]), offeredSlots: z.array(slotSummarySchema), selectedSlotId: z.string().nullable(),
  pendingTimes: z.array(z.string()),
  offeredDates: z.array(dateSchema).default([]), dateOffset: z.number().int().nonnegative().default(0),
  latest: z.object({ turnId: z.number().int(), outcome: readOutcomeSchema, doctors: z.array(voiceDoctorSchema), alternatives: z.array(voiceDoctorSchema), dates: z.array(dateSchema),
    times: z.array(slotSummarySchema), specialty: z.string().nullable() }).strict().nullable(),
}).strict();
export const doctorResultSchema = z.object({ outcome: readOutcomeSchema, doctors: z.array(voiceDoctorSchema), alternatives: z.array(voiceDoctorSchema), resultCount: z.number().int().nonnegative() }).strict();

export class ClinicDialogue {
  state: z.infer<typeof readStateSchema> = { candidates: [], selectedDoctor: null, selectedDate: null, question: "none", offeredSlots: [], selectedSlotId: null, pendingTimes: [], offeredDates: [], dateOffset: 0, latest: null };
  request: CalendarRequest = {};
  constructor(public timezone: string) {}
  reset() { this.state = { candidates: [], selectedDoctor: null, selectedDate: null, question: "none", offeredSlots: [], selectedSlotId: null, pendingTimes: [], offeredDates: [], dateOffset: 0, latest: null }; this.request = {}; }
  plan(text: string, localDate: string): { call?: NonNullable<TurnOptions["initialToolCall"]>; guidance?: "doctor" | "date" | "time" | "ampm" } {
    const t = text.normalize("NFKC").trim(); this.request = calendarRequest(t, localDate, this.state.question === "time" || this.state.question === "ampm");
    if (this.request.conflicting) return { guidance: "time" };
    if (!this.request.date && this.state.offeredDates.length && this.state.question === "date") {
      const choice = offeredDateChoice(t, this.state.offeredDates);
      if (choice.status === "matched") this.request.date = choice.date!;
      else if (choice.status === "ambiguous" || choice.status === "unavailable") return { guidance: "date" };
    }
    if (this.state.question === "time" && /^\d{1,2}(?::[0-5]\d)?$/u.test(t)) this.request = calendarRequest(`${t} o'clock`, localDate);
    if (this.state.question === "ampm" && this.state.pendingTimes.length) {
      const morning = /morning|ৰাতিপুৱা|সকাল|सुबह/iu.test(t), evening = /afternoon|evening|আবেলি|বিয়লি|शाम/iu.test(t);
      if (morning !== evening) this.request.times = this.state.pendingTimes.filter(time => morning ? Number(time.slice(0, 2)) < 12 : Number(time.slice(0, 2)) >= 12);
    }
    const doctorList = /which.*doctors?|list.*doctors?|কোন.*(?:ডক্টৰ|ডাক্তৰ|ডাক্টৰ|চিকিৎসক)|(?:ডক্টৰ|ডাক্তৰ|চিকিৎসক).*কোন|কোন কোন|कौन.*डॉक्टर/iu.test(t);
    const specialty = /gastro|গেছৰ|গেষ্ট্ৰ|গ্যাস্ট্র/iu.test(t) ? "Gastroenterology" : /cardiolog|কাৰ্ডি|कार्डि/iu.test(t) ? "Cardiology" : undefined;
    if (doctorList || specialty) return { call: { name: "list_doctors", arguments: specialty ? { specialty } : {} } };
    const named = /(?:\bdr\.|\bdoctor\s|\bdr\s|ডাঃ|ডঃ|ডা\.|ডাক্টৰ|ডাক্তৰ|ডক্টৰ|डॉक्टर)\s*([^?।!,]+)/iu.exec(t);
    if (named?.[1]) {
      const name = named[1].split(/\s+(?:লগত|সৈতে|কৈ|বিচাৰ|লাগ|appointment|please|के|से)/iu)[0]!.trim();
      if (name) return { call: { name: "find_doctor", arguments: { name } } };
    }
    const hasCalendar = Boolean(this.request.date || this.request.times || /dates?|times?|তাৰিখ|সময়|বজাত|কেতিয়া|तारीख|समय/iu.test(t)
      || (this.state.selectedDoctor && /available|availability|এভেইল|খালী|উপলব্ধ|কোন.*দিন|ডে['’]?ত/iu.test(t)));
    if (hasCalendar) {
      if (!this.state.selectedDoctor) { this.state.question = "doctor"; return { guidance: "doctor" }; }
      if (this.request.ambiguous && !this.request.times) { this.state.question = "ampm"; return { guidance: "ampm" }; }
      const datesOnly = !this.request.date && !this.request.times && /dates?|তাৰিখ|দিন|ডে['’]?ত|तारीख/iu.test(t);
      const date = datesOnly ? undefined : this.request.date ?? this.state.selectedDate;
      if (date) return { call: { name: "get_available_times", arguments: { doctorId: this.state.selectedDoctor.id, date } } };
      return { call: { name: "get_available_dates", arguments: { doctorId: this.state.selectedDoctor.id,
        ...(/more|next|আৰু|অন্য/iu.test(t) && this.state.offeredDates.length ? { offset: this.state.dateOffset + this.state.offeredDates.length } : {}) } } };
    }
    const answer = t.replace(/[।.!?]+$/gu, "").trim();
    if (this.state.question === "doctor" && /^[\p{L}\p{M} .'’-]+$/u.test(answer) && answer.split(/\s+/u).length <= 5 && !/^(?:হয়|হয়|নহয়|yes|no|hello|হেল্ল|নমস্কাৰ|ঠিক|শুদ্ধ)|what.*say|কি.*ক[ও']|क्या.*बोल/iu.test(answer)) {
      return { call: { name: "find_doctor", arguments: { name: answer } } };
    }
    return {};
  }
  select(doctor: VoiceDoctor) {
    const changed = this.state.selectedDoctor?.id !== doctor.id;
    this.state.selectedDoctor = structuredClone(doctor);
    if (changed) { this.state.selectedDate = null; this.state.offeredSlots = []; this.state.selectedSlotId = null; this.state.pendingTimes = []; this.state.offeredDates = []; this.state.dateOffset = 0; }
    this.state.question = "date"; return changed;
  }
  doctors(turnId: number, doctors: VoiceDoctor[], alternatives: VoiceDoctor[] = [], specialty: string | null = null, listing = false) {
    const active = doctors.filter(d => d.isActive);
    const outcome = listing ? doctors.length ? "listed" : "not_found" : !doctors.length ? "not_found" : !active.length ? "inactive" : doctors.length === 1 ? "matched" : "ambiguous";
    this.state.candidates = structuredClone(doctors); this.state.question = "doctor";
    if (outcome === "matched") this.select(active[0]!);
    else if (!listing) { this.state.selectedDoctor = null; this.state.selectedDate = null; this.state.offeredSlots = []; this.state.selectedSlotId = null; this.state.offeredDates = []; this.state.dateOffset = 0; }
    this.state.latest = { turnId, outcome, doctors, alternatives, dates: [], times: [], specialty };
    return { outcome, doctors, alternatives, resultCount: doctors.length };
  }
  dates(turnId: number, dates: string[], offset = 0) {
    this.state.question = "date";
    this.state.offeredDates = dates.slice(offset, offset + 3); this.state.dateOffset = offset;
    this.state.latest = { turnId, outcome: dates.length ? "dates_available" : "no_availability", doctors: [], alternatives: [], dates, times: [], specialty: null };
    return dates.map(date => calendarDate(date, this.timezone));
  }
  times(turnId: number, date: string, times: z.infer<typeof slotSummarySchema>[]) {
    this.state.selectedDate = times.length ? date : null; this.state.offeredSlots = structuredClone(times); this.state.selectedSlotId = null;
    this.state.question = "time";
    if (this.request.times) {
      const matches = times.filter(slot => this.request.times!.includes(slot.startTime.slice(0, 5)));
      if (matches.length === 1) { this.state.selectedSlotId = matches[0]!.id; this.state.question = "patient"; }
      else if (matches.length > 1 && this.request.ambiguous) { this.state.question = "ampm"; this.state.pendingTimes = [...this.request.times]; }
    }
    this.state.latest = { turnId, outcome: times.length ? "times_available" : "no_availability", doctors: [], alternatives: [], dates: [date], times, specialty: null };
  }
  problem(turnId: number, outcome: "service_error" | "disabled") {
    this.state.latest = { turnId, outcome, doctors: [], alternatives: [], dates: [], times: [], specialty: null };
  }
  /** Only accept references to records already returned for the current doctor. */
  choose(date: string | null, slotId: string | null): boolean {
    if (!this.state.selectedDoctor) return false;
    const slot = slotId ? this.state.offeredSlots.find(s => s.id === slotId && s.slotDate === (date ?? this.state.selectedDate)) : undefined;
    if (slotId && !slot) return false;
    if (date && date !== this.state.selectedDate && !this.state.offeredDates.includes(date)) return false;
    if (date && date !== this.state.selectedDate) { this.state.selectedDate = date; this.state.offeredSlots = []; this.state.selectedSlotId = null; }
    if (slot) this.state.selectedSlotId = slot.id;
    this.state.question = this.state.selectedSlotId ? "patient" : "time";
    return true;
  }
  render(language: AgentLanguage, patientQuestion?: string): string {
    const r = this.state.latest; if (!r) return "";
    const names = (doctors: VoiceDoctor[]) => doctors.slice(0, 5).map(d => doctorName(d, language)).join(", ");
    const choose = { as: "আপুনি কোনজন চিকিৎসকৰ সৈতে দেখা কৰিব বিচাৰে?", hi: "आप किस डॉक्टर से मिलना चाहते हैं?", en: "Which doctor would you like to see?" }[language];
    if (r.outcome === "listed") return ({ as: `ক্লিনিকৰ চিকিৎসকসকল: ${names(r.doctors)}। ${choose}`, hi: `क्लिनिक के डॉक्टर: ${names(r.doctors)}। ${choose}`, en: `The clinic doctors are ${names(r.doctors)}. ${choose}` })[language];
    if (r.outcome === "matched") return ({ as: `${names(r.doctors)}ক পালোঁ। আপুনি কোন তাৰিখে যাব বিচাৰে?`, hi: `${names(r.doctors)} मिले। आप किस तारीख को आना चाहते हैं?`, en: `I found ${names(r.doctors)}. Which date would you prefer?` })[language];
    if (r.outcome === "ambiguous") return ({ as: `একে নামৰ একাধিক চিকিৎসক পালোঁ: ${names(r.doctors)}। ${choose}`, hi: `इस नाम के कई डॉक्टर मिले: ${names(r.doctors)}। ${choose}`, en: `Several doctors match: ${names(r.doctors)}. ${choose}` })[language];
    if (r.outcome === "not_found" || r.outcome === "inactive") return ({
      as: `${r.specialty ? `${r.specialty} বিশেষজ্ঞৰ নাম` : "সেই নামৰ সক্ৰিয় চিকিৎসক"} পোৱা নগ'ল। ${r.alternatives.length ? `ক্লিনিকৰ চিকিৎসকসকল: ${names(r.alternatives)}। ${choose}` : "অনুগ্ৰহ কৰি ক্লিনিকৰ সৈতে যোগাযোগ কৰক।"}`,
      hi: `उस नाम या विशेषज्ञता का सक्रिय डॉक्टर नहीं मिला। ${r.alternatives.length ? `क्लिनिक के डॉक्टर: ${names(r.alternatives)}। ${choose}` : "कृपया क्लिनिक से संपर्क करें।"}`,
      en: `No active doctor matched${r.specialty ? ` ${r.specialty}` : " that name"}. ${r.alternatives.length ? `The clinic doctors are ${names(r.alternatives)}. ${choose}` : "Please contact the clinic."}`,
    })[language];
    if (r.outcome === "service_error" || r.outcome === "disabled") return ({
      as: r.outcome === "disabled" ? "এই এজেণ্টৰ বাবে সেই সুবিধা সক্ৰিয় কৰা হোৱা নাই।" : "ক্লিনিকৰ তথ্য এতিয়া আনিব পৰা নাই। অনুগ্ৰহ কৰি অলপ পিছত চেষ্টা কৰক।",
      hi: r.outcome === "disabled" ? "इस एजेंट के लिए यह सुविधा चालू नहीं है।" : "अभी क्लिनिक की जानकारी नहीं मिल रही है। कृपया कुछ देर बाद कोशिश करें।",
      en: r.outcome === "disabled" ? "That capability is not enabled for this agent." : "I could not retrieve the clinic information. Please try again shortly.",
    })[language];
    if (r.outcome === "no_availability") return ({ as: "সেই পছন্দৰ বাবে উপলব্ধ তাৰিখ বা সময় পোৱা নগ'ল। আপুনি আন তাৰিখ চাব বিচাৰেনে?", hi: "इस चयन के लिए समय उपलब्ध नहीं मिला। क्या दूसरी तारीख देखें?", en: "No availability was returned for that selection. Would you like another date?" })[language];
    if (r.outcome === "dates_available") {
      const dates = this.state.offeredDates.map(d => spokenDate(d, language, false)).join(", ");
      return ({ as: `উপলব্ধ তাৰিখ: ${dates}। আপুনি কোন তাৰিখ বাছিব?`, hi: `उपलब्ध तारीखें: ${dates}। कौन सी तारीख चुनेंगे?`, en: `Available dates are ${dates}. Which date would you prefer?` })[language];
    }
    if (this.state.question === "ampm") return ({ as: "সেই তাৰিখত ৰাতিপুৱা আৰু আবেলি দুয়োটা সময় পোৱা গৈছে। আপুনি কোনটো বিচাৰে?", hi: "सुबह और शाम दोनों समय उपलब्ध हैं। आप कौन सा चाहते हैं?", en: "Both morning and afternoon times match. Which did you mean?" })[language];
    const selected = r.times.find(t => t.id === this.state.selectedSlotId);
    const times = (selected ? [selected] : r.times.slice(0, 3)).map(t => spokenTime(t.startTime, language)).join(", ");
    const date = spokenDate(r.dates[0]!, language);
    return ({ as: `${date}ত উপলব্ধ সময়: ${times}। ${selected ? patientQuestion ?? "ৰোগীৰ নামটো কওক।" : "আপুনি কোন সময় বাছিব?"}`,
      hi: `${date} को उपलब्ध समय: ${times}। ${selected ? patientQuestion ?? "मरीज का नाम बताएं।" : "कौन सा समय चुनेंगे?"}`,
      en: `Available on ${date}: ${times}. ${selected ? patientQuestion ?? "What is the patient's name?" : "Which time would you prefer?"}` })[language];
  }
  useful(text: string): boolean {
    const r = this.state.latest; if (!r || /আকৌ.*কওক|আকৌ.*ক'ব|repeat|say.*again|दोबारा|स्पष्ट/iu.test(text)) return false;
    const names = [...r.doctors, ...r.alternatives];
    if (names.length) {
      if (r.outcome === "matched" && /not found|no match|পোৱা নগ'ল|নাম.*বুজি|नहीं मिला|কোনজন.*চিকিৎসক.*বিচাৰে/iu.test(text)) return false;
      if (r.outcome === "matched" && /[?？]/u.test(text) && !/date|day|তাৰিখ|কোনদিন|কোন.*দিন|কেতিয়া|तारीख|दिन/iu.test(text)) return false;
      const mentioned = (d: VoiceDoctor) => [d.name, d.nameEn, d.nameAs, ...d.searchAliases ?? []].some(name => name && doctorSearchKey(text).includes(doctorSearchKey(name).replace(/\s*\(voice test\)/u, "")));
      return names.slice(0, 5).some(mentioned) && (r.outcome !== "ambiguous" || /which|choose|কোন|বাছ|कौन|चुन/iu.test(text));
    }
    // Calendar and empty/error outcomes use the verified renderer unless an exact
    // canonical value appears. This is a bounded check, not a semantic proof.
    const normalized = (value: string) => value.normalize("NFKC").replace(/[০-৯]/gu, c => String(c.charCodeAt(0) - 0x09e6))
      .replace(/[०-९]/gu, c => String(c.charCodeAt(0) - 0x0966)).replace(/[.,:।]/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase();
    const answer = normalized(text);
    const mentions = (value: string) => answer.includes(normalized(value));
    if (r.outcome === "dates_available") return ["matched", "ambiguous"].includes(offeredDateChoice(text, this.state.offeredDates).status) || r.dates.some(date => [date, ...(["as", "hi", "en"] as const).flatMap(lang => [spokenDate(date, lang),
      new Intl.DateTimeFormat(lang === "as" ? "as-IN" : lang === "hi" ? "hi-IN" : "en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`))])].some(mentions));
    if (r.outcome === "times_available") return (r.times.some(slot => [slot.startTime.slice(0, 5), ...(["as", "hi", "en"] as const).map(lang => spokenTime(slot.startTime, lang))].some(mentions))
      || calendarRequest(text, r.dates[0]!, true).times?.some(time => r.times.some(slot => slot.startTime.slice(0, 5) === time)) === true) && this.state.question !== "ampm";
    return false;
  }
}
