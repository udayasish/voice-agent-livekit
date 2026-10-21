/** Shared by reference-data validation and lookup; never transliterates or guesses a name. */
export const normalizeDoctorName = (text: string): string => text.normalize("NFKC").trim()
  .replace(/^(?:dr\.|(?:dr|doctor)(?=\s|$)|ডাঃ|ডঃ|ডা\.|ডাক্টৰ|ডাক্তৰ|ডক্টৰ|डॉक्टर)\s*/iu, "")
  .replace(/\s+/gu, " ").trim();
export const doctorSearchKey = (text: string): string => normalizeDoctorName(text).toLocaleLowerCase("en")
  .replace(/[.।,'’]/gu, " ").replace(/\s+/gu, " ").trim();

export interface DoctorNames { name: string; nameEn?: string | null | undefined; nameAs?: string | null | undefined; searchAliases?: readonly string[] | undefined }
export function doctorName(doctor: DoctorNames, language: string): string {
  return (language === "as" ? doctor.nameAs : doctor.nameEn) || doctor.name;
}
