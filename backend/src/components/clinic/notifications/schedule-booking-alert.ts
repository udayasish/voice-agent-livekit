// Adapted from notifications/queue/schedule-booking-alert.ts.
import type { NotificationStatus } from "../contracts/results.js";
import type { NotificationAppointment, NotificationDependencies } from "./types.js";
import { enqueueNotification } from "./schedule.js";

export async function scheduleBookingAlert(appointment: NotificationAppointment, enabled: boolean, deps: NotificationDependencies): Promise<NotificationStatus> {
  if (!enabled) return "disabled";
  return enqueueNotification({ kind: "doctor-booking-alert", organizationId: appointment.organizationId, appointmentId: appointment.id,
    appointmentVersion: appointment.version ?? 1,
    jobId: `clinic-${appointment.organizationId}-${appointment.id}-v${appointment.version ?? 1}-booking-alert`, runAt: deps.now().toISOString() }, deps);
}
