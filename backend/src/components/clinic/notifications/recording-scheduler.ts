import type { ClinicNotificationJob, ClinicNotificationScheduler } from "./types.js";

// Test/smoke adapter only: records requests; does not deliver or persist jobs.
export class RecordingClinicScheduler implements ClinicNotificationScheduler {
  private readonly jobs: ClinicNotificationJob[] = [];
  async schedule(job: ClinicNotificationJob): Promise<void> { this.jobs.push(Object.freeze({ ...job })); }
  snapshot(): readonly ClinicNotificationJob[] { return Object.freeze(this.jobs.map((job) => Object.freeze({ ...job }))); }
}
