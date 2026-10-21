import { z } from "zod";
import { containsPhoneNumberCandidate, normalizePhoneNumber, formatPhoneNumberForSpeech, phoneConfirmation } from "../normalizers/index.js";
import { agentConfigSchema, type AgentConfig, type AgentLanguage } from "../engine/config.js";
import type { BusinessBehavior, DeepReadonly } from "../engine/state.js";

export const conversationSlotsSchema = z.object({
  doctor: z.string().optional(), department: z.string().optional(), dateOrTime: z.string().optional(),
  patientName: z.string().optional(), phoneNumber: z.string().optional(),
}).strict();
export type ConversationSlots = z.infer<typeof conversationSlotsSchema>;
const questionSchema = z.enum(["doctor", "dateOrTime", "patientName", "phoneNumber", "phoneConfirmation"]);
const clinicStateSchema = z.object({ slots: conversationSlotsSchema, intakeActive: z.boolean(), lastQuestion: questionSchema.nullable(),
  phoneDraftText: z.string(), phoneConfirmed: z.boolean(), phoneIssue: z.enum(["unclear", "overflow"]).nullable() }).strict();
export type ClinicDemoState = z.infer<typeof clinicStateSchema>;

/** Intake demo only. Values are caller requests, never verified business facts. */
export function extractSlotsFromText(userText: string, existingSlots: ConversationSlots = {}): ConversationSlots {
  const slots = { ...existingSlots };
  const text = userText.trim();
  if (containsPhoneNumberCandidate(text)) {
    const number = normalizePhoneNumber(text);
    if (number.isValid && number.unrecognizedTokens.length === 0 && !number.hasPendingMultiplier) slots.phoneNumber = number.digits;
  }
  const doctor = text.match(/(?:(?:ডা?[ঃ.:])\s*|(?:ডাক্টৰ|ডাক্তৰ|ডক্টৰ|ডাক্টর|ডাক্তার)(?:ৰ)?\s+)([^।?,!]+)/u);
  const doctorSuffix = text.match(/([^\s।?,!]+)\s+(?:ডাক্টৰ|ডাক্তৰ|ডক্টৰ|ডাক্টর|ডাক্তার)/u);
  const englishDoctor = text.match(/(?:[Dd]r\.?|[Dd]octor)\s+([A-Za-z]+(?:\s+[A-Z][a-z]+)?)/u);
  const assameseDoctor = doctor?.[1] ?? doctorSuffix?.[1];
  if (assameseDoctor) {
    const parts: string[] = [];
    for (const part of assameseDoctor.trim().split(/\s+/u)) {
      if (parts.length === 4 || !shortNameAnswer(part)) break;
      parts.push(part.replace(/^(বৰুৱা|শৰ্মা|হাজৰিকা)(?:ৰ|ক)$/u, "$1"));
    }
    if (parts.length) slots.doctor = `ডাঃ ${parts.join(" ")}`;
  }
  else if (englishDoctor?.[1] && shortNameAnswer(englishDoctor[1])) slots.doctor = `Dr. ${englishDoctor[1]}`;
  const date = text.match(/(?:কাইলৈ|আজি)(?:\s+(?:ৰাতিপুৱা|পুৱা|দুপৰীয়া|আবেলি|সন্ধিয়া|ৰাতি)(?![\p{L}\p{M}]))?(?:\s+[^\s।?,!]+\s+বজাত)?|(?:tomorrow|today)(?:\s+(?:morning|afternoon|evening))?(?:\s+at\s+\d+(?::\d+)?\s*(?:am|pm)?)?|(?:\d+|দহ|দশ)\s+বজাত/iu);
  if (date) slots.dateOrTime = date[0].trim();
  const name = text.match(/(?:মোৰ\s+নামটো|মোৰ\s+নাম|মো\s+নামটো|নামটো|নাম|my name is)\s*(?:হৈছে|হয়)?\s*([^।?,!]+)/iu);
  if (name?.[1] && !name[1].includes("ফোন") && !name[1].includes("নম্বৰ")) slots.patientName = name[1].trim();
  return conversationSlotsSchema.parse(slots);
}

/** Accept a name-only answer only when intake is waiting for that detail. */
function shortNameAnswer(text: string): string | undefined {
  const name = text.trim().replace(/[।॥.!]+$/u, "").trim();
  if (!/^[\p{L}\p{M}]+(?:[ '\u2019.-][\p{L}\p{M}]+){0,3}$/u.test(name)) return undefined;
  if (/^(?:নৌ|নো|নহয়|হয়|এক|এজন|no|yes|না|हाँ)$/iu.test(name) || /(?:^|\s)এজন(?:\s|$)/u.test(name)) return undefined;
  if (/(?:^|\s)(?:নমস্কাৰ|নমস্তে|ধন্যবাদ|কাইলৈ|আজি|পুৱা|ৰাতিপুৱা|ৰাতি|আবেলি|বজাত|নাম|নামটো|ফোন|নম্বৰ|এপইণ্টমেণ্ট|কোন|কোনজন|কিয়|কেনেকৈ|ৰব|নাজানো|চিকিৎসক|হিন্দী|ইংৰাজী|অসমীয়া|মই|মোক|আপুনি|লগত|লগতে|সৈতে|দেখুৱাব|বিচাৰোঁ|বিচাৰিছিল|আছিল|লৈছিল|hello|hi|thanks|tomorrow|today|appointment|doctor|consultation|available|please|phone|name|what|who|why|how|stop|wait|know|english|hindi|नमस्ते|धन्यवाद|कौन|नहीं|कल)(?=$|\s)/iu.test(name)) return undefined;
  return name;
}

export function detectRepetition(userText: string, state: {
  slots: ConversationSlots; lastUserUtterance?: string | undefined;
}): boolean {
  if (!state.lastUserUtterance) return false;
  if (userText.trim() === state.lastUserUtterance.trim()) return true;
  const newSlots = extractSlotsFromText(userText);
  return Object.entries(newSlots).some(([key, value]) => state.slots[key as keyof ConversationSlots] === value);
}

export function createClinicDemoConfig(businessName: string, agentId = "clinic-demo"): AgentConfig {
  return agentConfigSchema.parse({ agentId, name: "Voice receptionist", businessName,
    instructions: "Clinic intake demonstration. Ask for the requested doctor and date/time, caller name and phone, one detail at a time. Do not provide medical advice. Collected details are unverified and only retained in this conversation. No booking, registration, availability lookup or durable request submission is possible.",
    languages: ["as", "hi", "en"], defaultLanguage: "as" });
}

function intakeResponse(state: DeepReadonly<ClinicDemoState>, language: AgentLanguage, previousResponse?: string): string {
  const slot = !state.slots.doctor ? "doctor" : !state.slots.dateOrTime ? "time"
    : !state.slots.patientName ? "name" : !state.slots.phoneNumber ? "phone" : "complete";
  if (slot === "phone") {
    const count = normalizePhoneNumber(state.phoneDraftText).digitCount;
    if (state.phoneIssue === "unclear") {
      const clarification = {
        as: "কিছুমান অংক স্পষ্ট নহ'ল। অনুগ্ৰহ কৰি নম্বৰটো নতুনকৈ কওক; মই আপোনাৰ কথা শেষ হোৱালৈ অপেক্ষা কৰিম।",
        hi: "कुछ अंक स्पष्ट नहीं हुए। कृपया नंबर शुरू से बताएं; मैं आपकी बात पूरी होने का इंतजार करूंगा।",
        en: "Some digits were unclear. Please start the number again; I'll wait for you to finish.",
      }[language];
      if (clarification !== previousResponse) return clarification;
      return {
        as: "নম্বৰটো স্পষ্টকৈ বুজিব পৰা নাই। অনুগ্ৰহ কৰি প্ৰতিটো অংক পৃথকে কওক, যেনে ডাবল জিৰ'ৰ সলনি জিৰ' জিৰ'।",
        hi: "नंबर स्पष्ट नहीं हुआ। कृपया हर अंक अलग बोलें, जैसे डबल ज़ीरो की जगह ज़ीरो ज़ीरो।",
        en: "I still couldn't understand the number. Please say each digit separately, for example zero zero instead of double zero.",
      }[language];
    }
    if (state.phoneIssue === "overflow") return {
      as: "নম্বৰটো দহটা অংকৰ সৈতে মিলা নাই। অনুগ্ৰহ কৰি নম্বৰটো নতুনকৈ কওক; মই শুনি আছোঁ।",
      hi: "नंबर दस अंकों से मेल नहीं खाता। कृपया शुरू से बताएं; मैं सुन रहा हूँ।",
      en: "That does not match a ten-digit mobile number. Please start again; I'm listening.",
    }[language];
    if (count > 0 && count < 10) {
      const clarification = {
        as: `মই ${count}টা অংক শুনিলোঁ। নম্বৰটো কৈ শেষ হ'ল যদি এটা এটাকৈ আকৌ কওক; নহ'লে বাকীখিনি কওক।`,
        hi: `मुझे ${count} अंक सुनाई दिए। अगर आपने पूरा नंबर बता दिया है तो हर अंक अलग दोबारा बोलें; वरना आगे बताएं।`,
        en: `I heard ${count} digits. If that was the whole number, please repeat it digit by digit; otherwise continue.`,
      }[language];
      if (clarification !== previousResponse) return clarification;
      return {
        as: "সম্পূৰ্ণ নম্বৰটো নিশ্চিত কৰিব পৰা নাই। অনুগ্ৰহ কৰি নতুনকৈ প্ৰতিটো অংক পৃথকে কওক।",
        hi: "पूरे नंबर की पुष्टि नहीं हो पाई। कृपया शुरू से हर अंक अलग बताएं।",
        en: "I haven't confirmed the full number. Please start again and say each digit separately.",
      }[language];
    }
  }
  if (slot === "complete" && !state.phoneConfirmed && state.slots.phoneNumber && state.lastQuestion === "phoneConfirmation") {
    const clarification = {
      as: "নম্বৰটো শুদ্ধনে? শুদ্ধ হ'লে 'হয়', ভুল হ'লে 'নহয়' বুলি কওক।",
      hi: "क्या नंबर सही है? सही हो तो हाँ, गलत हो तो नहीं कहें।",
      en: "Is that number correct? Please say yes if it is correct, or no if it is wrong.",
    }[language];
    if (clarification !== previousResponse) return clarification;
    return {
      as: "আপোনাৰ উত্তৰটো বুজি পোৱা নাই। নম্বৰটো ঠিক হ'লে 'হয়', নহ'লে 'নহয়' বুলি কওক।",
      hi: "मैं आपका जवाब समझ नहीं पाया। नंबर सही हो तो हाँ, वरना नहीं कहें।",
      en: "I haven't understood your answer. Say yes to confirm the number, or no to correct it.",
    }[language];
  }
  if (slot === "complete" && !state.phoneConfirmed && state.slots.phoneNumber) return {
    as: `মই আপোনাৰ নম্বৰ ${formatPhoneNumberForSpeech(state.slots.phoneNumber)} পালোঁ। এই নম্বৰটো শুদ্ধনে? এপইণ্টমেণ্ট বুক হোৱা নাই।`,
    hi: `आपका नंबर ${state.slots.phoneNumber.split("").join(" ")} है, क्या यह सही है? अपॉइंटमेंट बुक नहीं हुआ है।`,
    en: `I heard ${state.slots.phoneNumber.split("").join(" ")}; is that correct? An appointment has not been booked.`,
  }[language];
  const responses = {
    as: { doctor: "আপুনি কোনজন চিকিৎসকৰ ওচৰলৈ যাব বিচাৰে অনুগ্ৰহ কৰি কওক।",
      time: "আপুনি কোন তাৰিখে বা কি সময়ত যাব বিচাৰে?", name: "অনুগ্ৰহ কৰি আপোনাৰ সম্পূৰ্ণ নামটো ক'ব পাৰিবনে?",
      phone: "অনুগ্ৰহ কৰি আপোনাৰ ফোন নম্বৰটোৰ প্ৰতিটো অংক ইংৰাজীত কওক।",
      complete: "ধন্যবাদ, আপোনাৰ তথ্য এই কথোপকথনত আছে। এপইণ্টমেণ্ট বুক হোৱা নাই; নিশ্চিত কৰিবলৈ ক্লিনিকৰ সৈতে যোগাযোগ কৰক।" },
    hi: { doctor: "कृपया बताएं कि आप किस डॉक्टर से मिलना चाहते हैं?", time: "आप किस तारीख या समय पर आना चाहते हैं?",
      name: "कृपया अपना पूरा नाम बताएं।", phone: "कृपया अपने फोन नंबर का हर अंक अंग्रेज़ी में बताएं।",
      complete: "धन्यवाद, आपकी जानकारी इस बातचीत में है। अपॉइंटमेंट बुक नहीं हुआ है; पुष्टि के लिए क्लिनिक से संपर्क करें।" },
    en: { doctor: "Which doctor would you like to see?", time: "What date or time would you prefer?",
      name: "Could you please tell me your full name?", phone: "Please say your phone number in English, one digit at a time.",
      complete: "Thank you, your details are in this conversation. An appointment has not been booked; please contact the clinic to confirm." },
  };
  const response = responses[language][slot];
  if (response !== previousResponse) return response;
  // Clarify the unresolved field instead of playing the same sentence again.
  const clarification = {
    as: { doctor: "চিকিৎসকৰ নামটো বুজি পোৱা নাই। অনুগ্ৰহ কৰি কেৱল নামটো আকৌ এবাৰ ক'ব পাৰিবনে?",
      time: "আপোনাৰ পছন্দৰ তাৰিখ বা সময়টো বুজি পোৱা নাই। অনুগ্ৰহ কৰি আকৌ এবাৰ কওক।",
      name: "আপোনাৰ নামটো বুজি পোৱা নাই। অনুগ্ৰহ কৰি কেৱল সম্পূৰ্ণ নামটো কওক।",
      phone: "সম্পূৰ্ণ ফোন নম্বৰটো পোৱা নাই। অনুগ্ৰহ কৰি দহটা অংক এটা এটাকৈ কওক।",
      complete: "আপোনাৰ দিয়া তথ্য এই কথোপকথনত আছে। বুকিং নিশ্চিত কৰিবলৈ ক্লিনিকৰ সৈতে যোগাযোগ কৰিব লাগিব।" },
    hi: { doctor: "मैं डॉक्टर का नाम समझ नहीं पाया। कृपया केवल उनका नाम दोबारा बताएं।",
      time: "कृपया अपनी पसंद की तारीख या समय दोबारा बताएं।", name: "कृपया केवल अपना पूरा नाम दोबारा बताएं।",
      phone: "कृपया फोन नंबर के दस अंक एक-एक करके बताएं।", complete: "आपकी जानकारी इस बातचीत में है। बुकिंग की पुष्टि के लिए क्लिनिक से संपर्क करना होगा।" },
    en: { doctor: "I have not understood the doctor's name. Could you say just their name again?",
      time: "Could you repeat your preferred date or time?", name: "Could you say just your full name again?",
      phone: "Could you repeat all ten digits of your phone number, one at a time?",
      complete: "Your details are in this conversation. Please contact the clinic to confirm a booking." },
  };
  return clarification[language][slot];
}

export const clinicDemoBehavior: BusinessBehavior<ClinicDemoState> = {
  stateSchema: clinicStateSchema,
  initialState: () => ({ slots: {}, intakeActive: false, lastQuestion: null, phoneDraftText: "", phoneConfirmed: false, phoneIssue: null }),
  update: (text, state) => {
    const slots = extractSlotsFromText(text, state.slots);
    const explicitDetails = extractSlotsFromText(text);
    let phoneDraftText = state.phoneDraftText;
    let phoneConfirmed = state.phoneConfirmed;
    let phoneIssue = state.phoneIssue;
    if (state.lastQuestion === "phoneConfirmation") {
      const confirmation = phoneConfirmation(text);
      if (confirmation === "yes") phoneConfirmed = true;
      else if (confirmation === "no") {
        delete slots.phoneNumber; phoneDraftText = ""; phoneConfirmed = false; phoneIssue = null;
      }
    }
    if (state.lastQuestion === "phoneNumber" || explicitDetails.phoneNumber) {
      const restart = /আকৌ|নতুনকৈ|পুনৰ|start over|restart|again/iu.test(text);
      const numberText = text.replace(/আকৌ|নতুনকৈ|পুনৰ|start over|restart|again/giu, " ").trim();
      const part = normalizePhoneNumber(numberText);
      if (restart) phoneDraftText = "";
      if (part.unrecognizedTokens.length) { phoneIssue = "unclear"; phoneDraftText = ""; }
      else if (part.digitCount || /ডাবল|ডবল|double|ট্ৰিপল|triple/iu.test(numberText)) {
        phoneIssue = null;
        const joined = [phoneDraftText, numberText].filter(Boolean).join(" ");
        const joinedCount = normalizePhoneNumber(joined).digitCount;
        if (part.isValid || (joinedCount > 10 && part.digitCount >= 8 && /^[6-9]/u.test(part.digits))) phoneDraftText = numberText;
        else phoneDraftText = joined;
        const combined = normalizePhoneNumber(phoneDraftText);
        if (combined.isValid && !combined.hasPendingMultiplier) { slots.phoneNumber = combined.digits; phoneDraftText = ""; phoneConfirmed = false; }
        else if (combined.digitCount >= 10) { phoneDraftText = ""; phoneIssue = "overflow"; }
      }
    }
    const nameAnswer = state.intakeActive && Object.keys(explicitDetails).length === 0 ? shortNameAnswer(text) : undefined;
    if (nameAnswer && !state.slots.doctor && state.lastQuestion === "doctor") {
      slots.doctor = /[\u0980-\u09FF]/u.test(nameAnswer) ? `ডাঃ ${nameAnswer}` : nameAnswer;
    } else if (nameAnswer && state.lastQuestion === "patientName" && !state.slots.patientName) {
      slots.patientName = nameAnswer;
    }
    const intakeActive = state.intakeActive || Object.keys(slots).length > 0
      || /appointment|booking|এপইণ্টমেণ্ট|বুক|अपॉइंटमेंट/iu.test(text);
    return { slots, intakeActive, lastQuestion: state.lastQuestion, phoneDraftText, phoneConfirmed, phoneIssue };
  },
  promptContext: state => JSON.stringify(state),
  response: input => input.state.intakeActive ? intakeResponse(input.state, input.language, input.previousResponse) : input.text,
  onResponse: (text, state) => {
    // Track the question actually sent, including a model-generated greeting/intake question.
    const asks = /[?？]|কওক|ক'ব|বিচাৰে|পাৰিবনে|which|could|please|কোন|कृपया|कौन|बताएं/iu.test(text);
    // Recovery speech must not discard the detail we are still collecting.
    let lastQuestion: ClinicDemoState["lastQuestion"] = state.phoneConfirmed ? null : state.lastQuestion;
    if (state.slots.phoneNumber && !state.phoneConfirmed && /শুদ্ধনে|correct|सही/iu.test(text)) lastQuestion = "phoneConfirmation";
    else if (asks) {
      if (!state.slots.doctor && /চিকিৎসক|ডাক্তৰ|ডাক্টৰ|ডক্টৰ|doctor|डॉक्टर/iu.test(text)) lastQuestion = "doctor";
      else if (!state.slots.phoneNumber && /ফোন|নম্বৰ|অংক|phone|number|digits|नंबर|अंक/iu.test(text)) lastQuestion = "phoneNumber";
      else if (!state.slots.patientName && /নাম|name|नाम/iu.test(text)) lastQuestion = "patientName";
      else if (!state.slots.dateOrTime && /তাৰিখ|সময়|date|time|तारीख|समय/iu.test(text)) lastQuestion = "dateOrTime";
    }
    return { ...state, slots: { ...state.slots }, intakeActive: state.intakeActive || lastQuestion !== null, lastQuestion };
  },
};
