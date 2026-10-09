export type BenchmarkCategory =
  | "assamese"
  | "hindi"
  | "english"
  | "code_switching"
  | "names"
  | "dates"
  | "locations"
  | "background_noise"
  | "phone_quality";

export interface BenchmarkAudioProps {
  durationMs: number;
  fundamentalFreq: number;
  sampleRate?: number | undefined; // default: 16000, 8000 for phone_quality
  noiseType?: "none" | "hum" | "chatter" | "white" | undefined;
  snrDb?: number | undefined; // Signal-to-Noise ratio in dB (e.g., 15 for moderate noise, 10 for heavy noise)
}

export interface BenchmarkTestCase {
  id: string;
  category: BenchmarkCategory;
  categoryName: string;
  language: string; // "as", "hi", "en"
  referenceText: string;
  phoneticText: string;
  englishMeaning: string;
  keyEntities: Record<string, string>;
  audioProps: BenchmarkAudioProps;
}

/**
 * Repeatable STT Benchmark Dataset covering all 9 required testing dimensions
 * for clinic and conversational workflows.
 */
export const BENCHMARK_DATASET: BenchmarkTestCase[] = [
  // 1. Assamese (Pure)
  {
    id: "bm-as-01",
    category: "assamese",
    categoryName: "Assamese (Pure)",
    language: "as",
    referenceText: "নমস্কাৰ, মই ডাক্তৰৰ সৈতে এটা এপইণ্টমেণ্ট বুক কৰিব বিচাৰো।",
    phoneticText: "Namaskar, moi daktarar soite eta appointment book koribo bisaru.",
    englishMeaning: "Hello, I want to book an appointment with the doctor.",
    keyEntities: {
      action: "এপইণ্টমেণ্ট বুক",
      role: "ডাক্তৰৰ",
    },
    audioProps: {
      durationMs: 3200,
      fundamentalFreq: 180,
    },
  },
  {
    id: "bm-as-02",
    category: "assamese",
    categoryName: "Assamese (Pure)",
    language: "as",
    referenceText: "মোৰ পেটৰ বিষ হৈ আছে আৰু আজি দেখুৱাব লাগিব।",
    phoneticText: "Mor petor bikh hoi aase aru aji dekhuwabo lagibo.",
    englishMeaning: "I have a stomach ache and need to consult today.",
    keyEntities: {
      symptom: "পেটৰ বিষ",
      urgency: "আজি",
    },
    audioProps: {
      durationMs: 2900,
      fundamentalFreq: 195,
    },
  },

  // 2. Hindi (Pure)
  {
    id: "bm-hi-01",
    category: "hindi",
    categoryName: "Hindi (Multilingual)",
    language: "hi",
    referenceText: "नमस्ते, मुझे डॉक्टर से मिलने के लिए अपॉइंटमेंट चाहिए।",
    phoneticText: "Namaste, mujhe doctor se milne ke liye appointment chahiye.",
    englishMeaning: "Hello, I need an appointment to meet the doctor.",
    keyEntities: {
      action: "अपॉइंटमेंट",
      role: "डॉक्टर",
    },
    audioProps: {
      durationMs: 3100,
      fundamentalFreq: 185,
    },
  },

  // 3. English (Pure)
  {
    id: "bm-en-01",
    category: "english",
    categoryName: "English (Scheduling)",
    language: "en",
    referenceText: "Hello, I would like to schedule an appointment with Dr. Baruah for tomorrow morning.",
    phoneticText: "Hello, I would like to schedule an appointment with Dr. Baruah for tomorrow morning.",
    englishMeaning: "Hello, I would like to schedule an appointment with Dr. Baruah for tomorrow morning.",
    keyEntities: {
      doctorName: "Dr. Baruah",
      timing: "tomorrow morning",
    },
    audioProps: {
      durationMs: 3600,
      fundamentalFreq: 175,
    },
  },

  // 4. Code-Switching (Assamese + English Clinical Terms)
  {
    id: "bm-cs-01",
    category: "code_switching",
    categoryName: "Code-Switching (Assamese + English)",
    language: "as",
    referenceText: "মই কাইলৈ appointment book কৰিব বিচাৰো, Dr. Baruah ৰ clinic ত।",
    phoneticText: "Moi kailoi appointment book koribo bisaru, Dr. Baruah r clinic t.",
    englishMeaning: "I want to book an appointment tomorrow at Dr. Baruah's clinic.",
    keyEntities: {
      intent: "appointment book",
      doctorName: "Dr. Baruah",
      time: "কাইলৈ",
    },
    audioProps: {
      durationMs: 3500,
      fundamentalFreq: 180,
    },
  },

  // 5. Names (Assamese & Indian Personal & Provider Names)
  {
    id: "bm-name-01",
    category: "names",
    categoryName: "Names (Patient & Doctor)",
    language: "as",
    referenceText: "মোৰ নাম উদয়াশীষ বৰা আৰু মই ডাঃ হিমন্ত শৰ্মাৰ সৈতে কথা পাতিব বিচাৰো।",
    phoneticText: "Mor naam Udayasish Bora aru moi Dr. Himanta Sarma r soite kotha patibo bisaru.",
    englishMeaning: "My name is Udayasish Bora and I want to speak with Dr. Himanta Sarma.",
    keyEntities: {
      patientName: "উদয়াশীষ বৰা",
      doctorName: "ডাঃ হিমন্ত শৰ্মা",
    },
    audioProps: {
      durationMs: 4000,
      fundamentalFreq: 180,
    },
  },

  // 6. Dates & Times (Calendar dates, times of day)
  {
    id: "bm-date-01",
    category: "dates",
    categoryName: "Dates & Times",
    language: "as",
    referenceText: "কাইলৈ পুৱা ১০ বজাত নাইবা ১৫ অক্টোবৰত সময় হবনে?",
    phoneticText: "Kailoi puwa 10 bozat naiba 15 October-ot xomoy hobone?",
    englishMeaning: "Is time available tomorrow at 10 AM or on 15th October?",
    keyEntities: {
      relativeDate: "কাইলৈ",
      time: "১০ বজাত",
      calendarDate: "১৫ অক্টোবৰ",
    },
    audioProps: {
      durationMs: 3400,
      fundamentalFreq: 190,
    },
  },

  // 7. Locations (Guwahati & Assam Clinic Localities)
  {
    id: "bm-loc-01",
    category: "locations",
    categoryName: "Locations (Assam & Guwahati)",
    language: "as",
    referenceText: "গুৱাহাটীৰ পল্টন বজাৰ আৰু দিছপুৰ ক্লিনিকত চেম্বাৰ আছে নেকি?",
    phoneticText: "Guwahatir Paltan Bazar aru Dispur clinict chamber aase neki?",
    englishMeaning: "Is there a consultation chamber at Guwahati's Paltan Bazar and Dispur clinics?",
    keyEntities: {
      city: "গুৱাহাটী",
      locality1: "পল্টন বজাৰ",
      locality2: "দিছপুৰ",
    },
    audioProps: {
      durationMs: 3800,
      fundamentalFreq: 185,
    },
  },

  // 8. Background Noise (Acoustic Corruption with Clinic / Street Noise)
  {
    id: "bm-noise-01",
    category: "background_noise",
    categoryName: "Background Noise (15 dB SNR)",
    language: "as",
    referenceText: "নমস্কাৰ, মই ক্লিনিকলৈ আহি আছো আৰু এপইণ্টমেণ্ট কনফাৰ্ম কৰিব খুজিছো।",
    phoneticText: "Namaskar, moi clinic-loi aahi aasu aru appointment confirm koribo khujisu.",
    englishMeaning: "Hello, I am coming to the clinic and want to confirm my appointment.",
    keyEntities: {
      destination: "ক্লিনিক",
      action: "এপইণ্টমেণ্ট কনফাৰ্ম",
    },
    audioProps: {
      durationMs: 3500,
      fundamentalFreq: 180,
      noiseType: "chatter",
      snrDb: 15,
    },
  },

  // 9. Phone-Quality Audio (8 kHz Band-limited Telephony Simulation)
  {
    id: "bm-phone-01",
    category: "phone_quality",
    categoryName: "Phone-Quality Audio (8 kHz Telephony)",
    language: "as",
    referenceText: "মই ফোনযোগে ডাক্তৰৰ সময় ল'বলৈ বিচাৰিছো, অনুগ্ৰহ কৰি কাইলৈৰ শ্লট দিয়ক।",
    phoneticText: "Moi phon-zoge daktarar xomoy loboloi bisarisu, onugroh kori kailoir slot diyok.",
    englishMeaning: "I want to take a doctor's appointment over phone, please provide tomorrow's slot.",
    keyEntities: {
      channel: "ফোনযোগে",
      time: "কাইলৈৰ শ্লট",
    },
    audioProps: {
      durationMs: 3600,
      fundamentalFreq: 180,
      sampleRate: 8000, // Telephony 8kHz
      noiseType: "hum",
      snrDb: 20,
    },
  },
];
