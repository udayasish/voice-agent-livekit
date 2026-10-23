import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { doctorMetadataSchema } from "../src/components/clinic/services/doctor-metadata.js";
import { calendarDate, calendarRequest, offeredDateChoice } from "../src/components/clinic/voice/calendar.js";
import { ClinicDialogue, type VoiceDoctor } from "../src/components/clinic/voice/dialogue.js";
import { AgentSession } from "../src/components/agent/engine/index.js";
import { ToolRegistry, createServerTimeTool } from "../src/components/agent/tools/index.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";
import { containsCompletionClaim } from "../src/components/clinic/voice/confirmation.js";

const doctor: VoiceDoctor = { id: randomUUID(), name: "ডাঃ বৰুৱা", nameEn: "Dr. Baruah", nameAs: "ডাঃ বৰুৱা", searchAliases: ["Boruah"], isActive: true };

test("reported Assamese doctor requests exclude the surrounding request words", () => {
  const d = new ClinicDialogue("Asia/Kolkata");
  for (const text of ["মই ডঃ বৰুৱাক দেখাব বিচাৰিছোঁ।", "মই ডঃ বৰুৱাক দেখাব বিচাৰো।", "মই ডাঃ বৰুৱাক দেখুৱাব বিচাৰোঁ।"]) {
    assert.deepEqual(d.plan(text, "2026-10-22").call, { name: "find_doctor", arguments: { name: "বৰুৱাক" } });
  }
});

test("failed doctor lookup cannot announce an alternative as selected or ask for patient details", () => {
  const d = new ClinicDialogue("Asia/Kolkata");
  d.doctors(1, [], [doctor]);
  assert.equal(d.useful("ডাঃ বৰুৱা উপলব্ধ আছে। দয়া কৰি আপোনাৰ নাম ক'ব।"), false);
  assert.equal(d.useful("ডাঃ বৰুৱা উপলব্ধ। আপুনি তেওঁৰ সৈতে কিমান বয়সৰ (বছৰ) বয়সী?"), false);
  assert.match(d.render("as"), /কোনজন চিকিৎসক/u);
  assert.equal(d.plan("মোৰ নাম উদয়চিছ বৰা।", "2026-10-22", true).call, undefined);
  assert.equal(d.plan("উদয়চিছ বৰা", "2026-10-22", true).call, undefined);
  d.doctors(2, [doctor]);
  assert.equal(d.useful("ডাঃ বৰুৱা উপলব্ধ আছে। দয়া কৰি আপোনাৰ নাম ক'ব।"), false);
});

test("honest negative booking statements are not replaced as successful action claims", () => {
  assert.equal(containsCompletionClaim("Your appointment has not been booked yet."), false);
  assert.equal(containsCompletionClaim("এপইণ্টমেণ্ট বুক হোৱা নাই।"), false);
  assert.equal(containsCompletionClaim("It was not cancelled but it was booked."), true);
  assert.equal(containsCompletionClaim("আপোনাৰ এপইণ্টমেণ্ট বুক হৈছে।"), true);
});

test("reported mixed-language day question and offered spoken date retain the selected doctor", () => {
  const dialogue = new ClinicDialogue("Asia/Kolkata"); dialogue.doctors(1, [doctor]);
  assert.deepEqual(dialogue.plan("কিমান ডে'ত কোনটো কোনটো কোনটো ডে'ত এভেইলেবল আছে?", "2026-10-17").call,
    { name: "get_available_dates", arguments: { doctorId: doctor.id } });
  dialogue.dates(2, ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]);
  for (const phrase of ["হয় দেওবাৰ ওঠৰ অক্টোবৰ।", "Sunday eighteenth October", "১৮ অক্টোবৰ", "October 18", "रविवार अठारह अक्तूबर"]) {
    assert.equal(dialogue.plan(phrase, "2026-10-17").call?.name, "get_available_times", phrase);
    assert.equal(dialogue.request.date, "2026-10-18", phrase);
  }
  assert.equal(dialogue.state.selectedDoctor?.id, doctor.id);
  assert.equal(dialogue.useful("দেওবাৰে সময় আছে। আপুনি কোন সময়ত আহিব?"), true);
  assert.equal(dialogue.useful("দেওবাৰ আৰু সোমবাৰে খালী আছে। কোন দিন বিচাৰে?"), true);
  assert.doesNotMatch(dialogue.render("en"), /21 October/);
  dialogue.state.selectedDate = "2026-10-18";
  assert.equal(dialogue.plan("more dates", "2026-10-17").call?.name, "get_available_dates");
  assert.equal(dialogue.plan("more dates", "2026-10-17").call?.arguments &&
    (dialogue.plan("more dates", "2026-10-17").call!.arguments as { offset: number }).offset, 3);
});

test("offered calendar resolution clarifies repeated weekdays, conflicting days and absent options", () => {
  assert.equal(offeredDateChoice("Sunday", ["2026-10-18", "2026-10-25"]).status, "ambiguous");
  assert.equal(offeredDateChoice("Tuesday 18 October", ["2026-10-18", "2026-10-19"]).status, "unavailable");
  assert.equal(offeredDateChoice("18 November", ["2026-10-18"]).status, "unavailable");
  assert.equal(offeredDateChoice("Sunday at 10 am", ["2026-10-18", "2026-10-19"]).date, "2026-10-18");
  assert.equal(offeredDateChoice("দেওবাৰ ৰাতিপুৱা দহ বজাত", ["2026-10-18", "2026-10-19"]).date, "2026-10-18");
  assert.equal(offeredDateChoice("hello", ["2026-10-18"]).status, "none");
});

test("reported Assamese 26 and multilingual equivalents select October 26 without repeating the date lookup", () => {
  for (const phrase of ["ছাব্বিছ অক্টোবৰ", "কোৱা নহয় নহয়, ছাব্বিছ অক্টোবৰ।", "কোনো মই মাত্ৰ ছাব্বিছ অক্টোবৰ।",
    "ছাব্বিশ অক্টোবৰ", "26 October", "twenty six October", "twenty-sixth October", "২৬ অক্টোবৰ", "छब्बीस अक्टूबर"]) {
    const d = new ClinicDialogue("Asia/Kolkata"); d.doctors(1, [doctor]);
    d.dates(2, ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    assert.deepEqual(d.plan(phrase, "2026-10-23").call,
      { name: "get_available_times", arguments: { doctorId: doctor.id, date: "2026-10-26" } }, phrase);
  }
  assert.equal(offeredDateChoice("ছাব্বিছ অক্টোবৰ", ["2026-10-24", "2026-10-25"]).status, "unavailable");
  assert.equal(offeredDateChoice("26 or 27 October", ["2026-10-26", "2026-10-27"]).status, "ambiguous");
});

test("available-date replies cannot mix verified choices with an unsupported denial", () => {
  const d = new ClinicDialogue("Asia/Kolkata"); d.doctors(1, [doctor]);
  d.dates(2, ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  for (const text of ["দুখিত, ২৭ অক্টোবৰ উপলব্ধ নহয়। ২৪, ২৫ অথবা ২৬ অক্টোবৰ তাৰিখবোৰত ক'ব।",
    "27 October is unavailable. Choose 24 October, 25 October or 26 October.",
    "२७ अक्तूबर उपलब्ध नहीं है। २४ अक्तूबर चुनें।"]) assert.equal(d.useful(text), false, text);
  assert.equal(d.useful("24 October, 25 October or 26 October are available. Which date?"), true);
});
test("metadata requires reviewed Latin names, bounded distinct normalized aliases and strict context", () => {
  const data = { doctorId: doctor.id, nameEn: "Dr. Baruah", nameAs: "ডাঃ বৰুৱা", searchAliases: ["Baruah", "বৰুৱা"] };
  assert.equal(doctorMetadataSchema.safeParse(data).success, true);
  for (const value of [{ ...data, nameEn: "বৰুৱা" }, { ...data, searchAliases: ["Dr. Baruah", "  BARUAH "] }, { ...data, organizationId: randomUUID() }, { ...data, searchAliases: ["Dr."] }]) {
    assert.equal(doctorMetadataSchema.safeParse(value).success, false);
  }
});
test("calendar expressions preserve concrete dates, English weekdays and ambiguous time candidates", () => {
  assert.deepEqual(calendarDate("2026-10-17", "Asia/Kolkata"), { date: "2026-10-17", weekday: "saturday", labelEn: "17 October 2026", timezone: "Asia/Kolkata" });
  assert.equal(calendarRequest("মোক পৰহিলে লাগে পৰহিলে সাত বজাত।", "2026-10-16").date, "2026-10-18");
  assert.deepEqual(calendarRequest("কাইলে এঘাৰটা বজাত।", "2026-10-16"), { date: "2026-10-17", times: ["11:00", "23:00"], ambiguous: true });
  assert.deepEqual(calendarRequest("কাইলৈ ৰাতিপুৱা ১০ বজাত", "2026-10-16"), { date: "2026-10-17", times: ["10:00"] });
  assert.equal(calendarRequest("কল", "2026-10-16").date, undefined);
  assert.equal(calendarRequest("कल सुबह दस बजे", "2026-10-16").date, "2026-10-17");
  assert.deepEqual(calendarRequest("2026-10-17 at 10 pm", "2026-10-16"), { date: "2026-10-17", times: ["22:00"] });
  assert.deepEqual(calendarRequest("hello", "2026-10-16"), {});
});
test("reported requests plan listing and preserve spoken spelling in doctor lookup", () => {
  const d = new ClinicDialogue("Asia/Kolkata");
  for (const text of ["কোন ডক্টৰ এভেইলেবল আছে?", "এভেইলেবল কোন কোন আছে?", "Which doctors are available?"]) assert.equal(d.plan(text, "2026-10-16").call?.name, "list_doctors");
  assert.deepEqual(d.plan("ডঃ বৰুৱা", "2026-10-16").call, { name: "find_doctor", arguments: { name: "বৰুৱা" } });
  assert.deepEqual(d.plan("Dr. Boruah", "2026-10-16").call, { name: "find_doctor", arguments: { name: "Boruah" } });
  assert.equal(d.plan("গেছৰ'ল'জি", "2026-10-16").call?.name, "list_doctors");
});
test("doctor selection clears incompatible choices; ambiguity cannot select", () => {
  const d = new ClinicDialogue("Asia/Kolkata");
  d.doctors(1, [doctor]); assert.equal(d.state.selectedDoctor?.id, doctor.id);
  d.state.selectedDate = "2026-10-17";
  d.doctors(2, [doctor, { ...doctor, id: randomUUID() }]);
  assert.equal(d.state.selectedDoctor, null); assert.equal(d.state.selectedDate, null);
  assert.match(d.render("en"), /Several doctors/);
  assert.equal(d.useful("Please say it again"), false);
  d.doctors(3, [doctor]); assert.equal(d.useful("I found Dr. Baruah. Which date would you prefer?"), true);
});
test("AM/PM clarification resolves only a returned slot, never an automatic alternative", () => {
  const d = new ClinicDialogue("Asia/Kolkata"); d.doctors(1, [doctor]);
  d.plan("tomorrow at 10 am", "2026-10-16");
  const slot = { id: randomUUID(), slotDate: "2026-10-17", startTime: "10:00:00", endTime: "10:15:00", maxPatients: 1, remainingCapacity: 1 };
  d.times(2, "2026-10-17", [slot]); assert.equal(d.state.selectedSlotId, slot.id);
  d.plan("10 o'clock", "2026-10-16");
  const late = { ...slot, id: randomUUID(), startTime: "22:00:00", endTime: "22:15:00" };
  d.times(3, "2026-10-17", [slot, late]); assert.equal(d.state.question, "ampm"); assert.equal(d.state.selectedSlotId, null);
  assert.equal(d.plan("ৰাতিপুৱা", "2026-10-16").call?.name, "get_available_times");
  d.times(4, "2026-10-17", [slot, late]); assert.equal(d.state.selectedSlotId, slot.id);
  d.plan("11 am", "2026-10-16"); d.times(5, "2026-10-17", [slot]); assert.equal(d.state.selectedSlotId, null);
});

test("English Hindi Assamese and phonetic clock answers select only offered slots", () => {
  for (const text of ["nine thirty", "नौ तीस", "ন ত্ৰিশ", "নাইন থাৰ্টি", "9:30", "नौ बजकर तीस"]) {
    const d = new ClinicDialogue("Asia/Kolkata"); d.doctors(1, [doctor]); d.state.selectedDate = "2026-10-18"; d.state.question = "time";
    assert.equal(d.plan(text, "2026-10-17").call?.name, "get_available_times", text);
    const slot = { id: randomUUID(), slotDate: "2026-10-18", startTime: "09:30:00", endTime: "09:45:00", maxPatients: 30, remainingCapacity: 30 };
    d.times(2, "2026-10-18", [slot]); assert.equal(d.state.selectedSlotId, slot.id, text);
    d.plan(text, "2026-10-17"); d.times(3, "2026-10-18", [{ ...slot, id: randomUUID(), startTime: "10:00:00" }]);
    assert.equal(d.state.selectedSlotId, null, text);
  }
  for (const text of ["ন বজা", "ন বজা ন বজা।", "নাইন নাইন", "nine am", "নাইন এএম", "सुबह नौ", "nine nine"]) {
    assert.ok(calendarRequest(text, "2026-10-17", true).times?.includes("09:00"), text);
  }
  assert.deepEqual(calendarRequest("9am", "2026-10-17").times, ["09:00"]);
  assert.deepEqual(calendarRequest("9pm", "2026-10-17").times, ["21:00"]);
  const d = new ClinicDialogue("Asia/Kolkata"); d.doctors(1, [doctor]); d.state.selectedDate = "2026-10-18"; d.state.question = "time";
  assert.equal(d.plan("nine am or ten am", "2026-10-17").guidance, "time");
  assert.equal(d.plan("not nine am", "2026-10-17").guidance, "time");
  assert.equal(d.state.selectedSlotId, null);
  assert.equal(calendarRequest("My age is twenty8", "2026-10-17").times, undefined);
});
test("planned SDK calls validate permissions/input before history and execute before provider generation", async () => {
  const context = { organizationId: "offline", agentId: "test", sessionId: randomUUID() };
  let executions = 0;
  const registry = new ToolRegistry([createServerTimeTool(() => { executions++; return new Date("2026-10-16T00:00:00Z"); })]);
  const provider = new ScriptedProvider(messages => { assert.equal(executions, 1); assert.ok(messages.some(m => m.role === "tool")); return [{ type: "text", delta: "The clock result is ready." }, { type: "done" }]; });
  const session = new AgentSession({ agentId: "test", name: "Test", businessName: "Example", instructions: "Use clock", languages: ["en"], defaultLanguage: "en", enabledTools: ["get_server_time"] }, context, provider,
    { stateSchema: (await import("zod")).z.object({}), initialState: () => ({}), update: () => ({}), promptContext: () => "" },
    { tools: { registry, callId: "call", conversationId: "conversation" } });
  try {
    for (const initialToolCall of [{ name: "missing", arguments: {} }, { name: "get_server_time", arguments: { organizationId: "forged" } }]) await assert.rejects(session.processUserUtterance("clock", { initialToolCall }));
    await assert.rejects(session.processUserUtterance("clock", { initialToolCall: { name: "get_server_time", arguments: {} }, allowedTools: [] }));
    assert.equal(session.getHistory().length, 0); assert.equal(executions, 0);
    await session.processUserUtterance("clock", { initialToolCall: { name: "get_server_time", arguments: {} } });
    assert.equal(executions, 1); assert.equal(provider.inputs.length, 1); assert.equal(session.getState().toolHistory.length, 1);
  } finally { await session.close(); }
});
