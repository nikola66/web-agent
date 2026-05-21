/** Heartbeat cron scheduling + user-facing delivery labels (embed runtime). */

export const CRON_SCHEDULING_MODE = "heartbeat_gated" as const;

export const CRON_SCHEDULING_NOTE =
  "Runs on a heartbeat tick after due while the tab is open; registering or refreshing does not execute the job.";

export type CronJobLike = {
  id?: string;
  enabled?: boolean;
  everyMinutes?: number;
  delivery?: string;
  notifyChannel?: string;
  deliveryEmailTo?: string;
  lastRunAt?: number;
  nextRetryAt?: number;
};

export function cronHeartbeatIntervalMinutes(heartbeatIntervalMs: number): number {
  return Math.max(1, Math.round(heartbeatIntervalMs / 60_000));
}

export function cronOutputDestination(job: CronJobLike): string {
  const delivery = String(job?.delivery ?? "terminal").trim().toLowerCase();
  const notify = String(job?.notifyChannel ?? "").trim();
  if (delivery === "silent") return "Silent";
  if (delivery === "email") return "Email";
  if (delivery === "terminal" && notify.startsWith("telegram:")) return "Web UI + Telegram";
  if (delivery === "terminal") return "Web UI";
  return "Web UI";
}

export function cronNextEligibleAtMs(job: CronJobLike, now = Date.now()): number {
  const everyMinutes = Math.max(1, Number(job?.everyMinutes ?? 30) || 30);
  const lastRunAt = Number(job?.lastRunAt ?? 0) || 0;
  const nextRetryAt = Number(job?.nextRetryAt ?? 0) || 0;
  const byInterval = lastRunAt + everyMinutes * 60_000;
  const candidates = [byInterval];
  if (nextRetryAt > 0) candidates.push(nextRetryAt);
  const raw = Math.max(...candidates);
  return job?.enabled === false ? raw : Math.max(raw, now);
}

export type EnrichedCronJobFields = {
  schedulingMode: typeof CRON_SCHEDULING_MODE;
  manualRunSupported: false;
  heartbeatIntervalMinutes: number;
  nextEligibleAtMs: number;
  outputDestination: string;
  schedulingNote: string;
};

export function enrichCronJobForList(
  job: CronJobLike,
  heartbeatIntervalMs: number,
  now = Date.now()
): EnrichedCronJobFields {
  return {
    schedulingMode: CRON_SCHEDULING_MODE,
    manualRunSupported: false,
    heartbeatIntervalMinutes: cronHeartbeatIntervalMinutes(heartbeatIntervalMs),
    nextEligibleAtMs: cronNextEligibleAtMs(job, now),
    outputDestination: cronOutputDestination(job),
    schedulingNote: CRON_SCHEDULING_NOTE,
  };
}

export function buildCronListSchedulingMeta(heartbeatIntervalMs: number) {
  return {
    schedulingMode: CRON_SCHEDULING_MODE,
    manualRunSupported: false as const,
    heartbeatIntervalMinutes: cronHeartbeatIntervalMinutes(heartbeatIntervalMs),
    schedulingNote: CRON_SCHEDULING_NOTE,
  };
}
