export interface ClinicNotificationJob {
  readonly kind: "appointment-reminder" | "doctor-booking-alert";
  readonly organizationId: string;
  readonly appointmentId: string;
  readonly jobId: string;
  readonly runAt: string;
}

// A future queue adapter must durably schedule and recheck status/settings at delivery.
export interface ClinicNotificationScheduler {
  schedule(job: ClinicNotificationJob): Promise<void>;
}

export interface ClinicLogger {
  info(message: string, metadata: Record<string, unknown>): unknown;
  warn(message: string, metadata: Record<string, unknown>): unknown;
  error(message: string, metadata: Record<string, unknown>): unknown;
}

export interface NotificationDependencies {
  readonly now: () => Date;
  readonly logger: ClinicLogger;
  readonly scheduler?: ClinicNotificationScheduler;
}

export interface NotificationAppointment {
  readonly id: string;
  readonly organizationId: string;
  readonly appointmentDate: string;
  readonly appointmentTime: string;
}
