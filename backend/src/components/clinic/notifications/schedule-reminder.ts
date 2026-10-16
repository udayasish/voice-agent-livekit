// Adapted from appointments/queue/schedule-reminder.ts; queue transport is injected.
import type { NotificationStatus } from "../contracts/results.js";
import { zonedTimeToUtc } from "../timezone.js";
import type { NotificationAppointment, NotificationDependencies } from "./types.js";
import { enqueueNotification } from "./schedule.js";

export async function scheduleReminder(appointment: NotificationAppointment, timezone: string, enabled: boolean, deps: NotificationDependencies): Promise<NotificationStatus> {
  if (!enabled) return "disabled";
  const fireAt = zonedTimeToUtc(appointment.appointmentDate, appointment.appointmentTime, timezone).getTime() - 24 * 60 * 60 * 1000;
  if (fireAt <= deps.now().getTime()) return "skipped_window";
  return enqueueNotification({ kind: "appointment-reminder", organizationId: appointment.organizationId, appointmentId: appointment.id,
    jobId: `clinic-${appointment.organizationId}-${appointment.id}-reminder`, runAt: new Date(fireAt).toISOString() }, deps);
}
