export interface AssameseSample {
  id: string;
  assameseText: string;
  romanText: string;
  englishMeaning: string;
  durationMs: number;
  expectedWords: string[];
  fundamentalFreq: number;
}

/**
 * Benchmark Assamese audio dataset definitions.
 * Representative speech samples covering clinic bookings, greetings, schedules, and doctor queries.
 */
export const ASSAMESE_SAMPLES: Record<string, AssameseSample> = {
  greeting: {
    id: "as-greeting",
    assameseText: "নমস্কাৰ, আপোনাক কেনেকৈ সহায় কৰিব পাৰো?",
    romanText: "Namaskar, aponak kenekoi sohay koribo paro?",
    englishMeaning: "Hello, how can I help you?",
    durationMs: 2200,
    expectedWords: ["নমস্কাৰ,", "আপোনাক", "কেনেকৈ", "সহায়", "কৰিব", "পাৰো?"],
    fundamentalFreq: 190,
  },
  appointmentBooking: {
    id: "as-appointment-query",
    assameseText: "মই ডাক্তৰৰ সৈতে এটা এপইণ্টমেণ্ট বুক কৰিব বিচাৰো।",
    romanText: "Moi daktarar soite eta appointment book koribo bisaru.",
    englishMeaning: "I want to book an appointment with the doctor.",
    durationMs: 3100,
    expectedWords: ["মই", "ডাক্তৰৰ", "সৈতে", "এটা", "এপইণ্টমেণ্ট", "বুক", "কৰিব", "বিচাৰো।"],
    fundamentalFreq: 175,
  },
  scheduleGuwahati: {
    id: "as-schedule-guwahati",
    assameseText: "মই কাইলৈ পুৱা দহ বজাত গুৱাহাটী ক্লিনিকলৈ আহিব বিচাৰো।",
    romanText: "Moi kailoi puwa doho bozat Guwahati clinic-loi ahibo bisaru.",
    englishMeaning: "I want to come to Guwahati clinic tomorrow morning at 10 AM.",
    durationMs: 3500,
    expectedWords: ["মই", "কাইলৈ", "পুৱা", "দহ", "বজাত", "গুৱাহাটী", "ক্লিনিকলৈ", "আহিব", "বিচাৰো।"],
    fundamentalFreq: 180,
  },
  doctorQuery: {
    id: "as-doctor-query",
    assameseText: "ডাক্তৰ বৰুৱা আজি চেম্বাৰত উপলব্ধ আছেনে?",
    romanText: "Daktar Baruah aji chamber-ot uplobdho aasone?",
    englishMeaning: "Is Dr. Baruah available at the chamber today?",
    durationMs: 2800,
    expectedWords: ["ডাক্তৰ", "বৰুৱা", "আজি", "চেম্বাৰত", "উপলব্ধ", "আছেনে?"],
    fundamentalFreq: 185,
  },
};
