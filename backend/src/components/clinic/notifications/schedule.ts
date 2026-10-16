import type { NotificationStatus } from "../contracts/results.js";
import type { ClinicNotificationJob, NotificationDependencies } from "./types.js";

export async function enqueueNotification(job: ClinicNotificationJob, deps: NotificationDependencies): Promise<NotificationStatus> {
  if (!deps.scheduler) return "unconfigured";
  const started = performance.now();
  try {
    await deps.scheduler.schedule(Object.freeze(job));
    deps.logger.info("Clinic notification scheduled", { organizationId: job.organizationId, appointmentId: job.appointmentId, kind: job.kind, durationMs: performance.now() - started });
    return "scheduled";
  } catch {
    deps.logger.error("Clinic notification scheduling failed", { organizationId: job.organizationId, appointmentId: job.appointmentId, kind: job.kind, errorCode: "NOTIFICATION_SCHEDULING_FAILED", durationMs: performance.now() - started });
    return "failed";
  }
}
