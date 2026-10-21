import { AppError } from "../../../lib/errors.js";

const messages = {
  APPOINTMENT_VERSION_CONFLICT: "The appointment changed. Reload it before trying again.",
  MUTATION_REQUEST_CONFLICT: "This request was already used or its result has changed.",
  APPOINTMENT_NOT_RESCHEDULABLE: "This appointment cannot be rescheduled.",
  RESCHEDULE_NO_CHANGE: "Choose a different slot.",
  SAME_DOCTOR_REQUIRED: "Rescheduling must keep the same doctor.",
  DOCTOR_HAS_BOOKINGS: "Clear future bookings before deactivating this doctor.",
  DATE_HAS_BOOKINGS: "Clear booked appointments before blocking this date.",
  SLOT_HAS_BOOKINGS: "This slot still has booked appointments.",
  SLOT_CONFLICT: "The slot definition conflicts with an existing slot.",
  SLOT_NOT_FOUND: "The slot was not found.",
  DOCTOR_PHONE_CONFLICT: "This clinic phone contact is already in use.",
  INVALID_CLINIC_INPUT: "The clinic request is invalid.",
  BOOKING_REQUEST_CONFLICT: "This booking request was already used for different details.",
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
