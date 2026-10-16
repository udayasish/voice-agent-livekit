import { AppError } from "../../../lib/errors.js";

const messages = {
  INVALID_CLINIC_INPUT: "The clinic request is invalid.",
  CLINIC_NOT_FOUND: "The clinic was not found.",
  CLINIC_UNAVAILABLE: "The clinic is unavailable.",
  INVALID_CLINIC_TIMEZONE: "The clinic timezone is invalid.",
  INVALID_CLINIC_TIME: "The appointment time needs clarification.",
  DOCTOR_NOT_FOUND: "The doctor was not found.",
  DOCTOR_INACTIVE: "The doctor is inactive.",
  PATIENT_NOT_FOUND: "The patient was not found.",
  PATIENT_ROLE_CONFLICT: "This contact cannot be used as a patient.",
  PATIENT_SCOPE_REQUIRED: "Verified patient context is required.",
  CLINIC_ACCESS_DENIED: "This clinic operation is not permitted.",
  SLOT_UNAVAILABLE: "The requested slot is unavailable.",
  APPOINTMENT_NOT_FOUND: "The appointment was not found.",
  APPOINTMENT_NOT_CANCELLABLE: "This appointment cannot be cancelled.",
  DATE_ALREADY_BLOCKED: "This doctor date is already blocked.",
  BLOCKED_DATE_NOT_FOUND: "The blocked date was not found.",
  CLINIC_OPERATION_FAILED: "The clinic operation could not be completed.",
} as const;
export type ClinicErrorCode = keyof typeof messages;

export class ClinicServiceError extends AppError {
  constructor(public readonly clinicCode: ClinicErrorCode) {
    super(messages[clinicCode], 400, clinicCode);
  }
}

export function clinicError(code: ClinicErrorCode): never { throw new ClinicServiceError(code); }
