import type { Serialized } from '../serialization.js';

/**
 * What a job is for. The type decides which step sequence the engine runs.
 */
export enum JobType {
  CAMPAIGN_ACTIVATE = 'CAMPAIGN_ACTIVATE',
  CAMPAIGN_REVERT = 'CAMPAIGN_REVERT',
  CSV_PARSE = 'CSV_PARSE',
  CSV_MATCH = 'CSV_MATCH',
}

export enum JobStatus {
  /** Ready to be claimed once `nextRunAt` has passed. */
  PENDING = 'PENDING',
  /** Waiting on a dependency that has not reached a terminal state. */
  BLOCKED = 'BLOCKED',
  RUNNING = 'RUNNING',
  /** Work handed to child jobs; completes when they all finish. */
  WAITING_CHILDREN = 'WAITING_CHILDREN',
  PAUSED = 'PAUSED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum JobExecutionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * The steps a job moves through. Order is defined per job type by
 * {@link JOB_STEPS} — the column stores which one is current, and the engine
 * resumes there after a crash or a pause.
 */
export enum JobStep {
  RESOLVE_TARGETS = 'RESOLVE_TARGETS',
  FETCH_PRICES = 'FETCH_PRICES',
  CHECK_PLAN_LIMIT = 'CHECK_PLAN_LIMIT',
  CALCULATE = 'CALCULATE',
  WRITE_CHANGES = 'WRITE_CHANGES',
  PUSH_PRICES = 'PUSH_PRICES',
  PUSH_TAGS = 'PUSH_TAGS',
  RESTORE_PRICES = 'RESTORE_PRICES',
  RESTORE_TAGS = 'RESTORE_TAGS',
  PARSE_FILE = 'PARSE_FILE',
  MATCH_SKUS = 'MATCH_SKUS',
  FINALIZE = 'FINALIZE',
}

/**
 * The step sequence per job type, in order.
 *
 * `CHECK_PLAN_LIMIT` sits deliberately after target resolution and before any
 * step that mutates Shopify: the quota must be known before the first write,
 * never discovered half way through.
 */
export const JOB_STEPS: Record<JobType, readonly JobStep[]> = {
  [JobType.CAMPAIGN_ACTIVATE]: [
    JobStep.RESOLVE_TARGETS,
    JobStep.FETCH_PRICES,
    JobStep.CHECK_PLAN_LIMIT,
    JobStep.CALCULATE,
    JobStep.WRITE_CHANGES,
    JobStep.PUSH_PRICES,
    JobStep.PUSH_TAGS,
    JobStep.FINALIZE,
  ],
  [JobType.CAMPAIGN_REVERT]: [
    JobStep.RESTORE_PRICES,
    JobStep.RESTORE_TAGS,
    JobStep.FINALIZE,
  ],
  [JobType.CSV_PARSE]: [JobStep.PARSE_FILE, JobStep.FINALIZE],
  [JobType.CSV_MATCH]: [
    JobStep.MATCH_SKUS,
    JobStep.FETCH_PRICES,
    JobStep.CALCULATE,
    JobStep.FINALIZE,
  ],
};

/** Statuses a job never leaves. Dependents are released on any of these. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
];

/**
 * Statuses that still occupy a deduplication key. A finished job releases its
 * key so the same work can legitimately be requested again later.
 */
export const LIVE_JOB_STATUSES: readonly JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.BLOCKED,
  JobStatus.RUNNING,
  JobStatus.WAITING_CHILDREN,
  JobStatus.PAUSED,
];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/**
 * The intent: what should happen, to what, under which constraints.
 *
 * A job is not a run. It is enqueued once and may be attempted many times —
 * each attempt is a {@link JobExecution}. That split is what keeps a retried
 * or resumed job legible instead of overwriting its own history.
 */
export interface Job {
  id: string;
  shopId: string;
  type: JobType;
  status: JobStatus;

  /** Set when this job was spawned by another to handle one batch. */
  parentJobId: string | null;

  /** At most one subject is set; a job may also have neither. */
  campaignId: string | null;
  csvImportId: string | null;

  /**
   * Jobs sharing a key never run at the same time within a shop, enforced by
   * a partial unique index rather than application logic. Campaign start and
   * end share one key so a campaign cannot be double-applied.
   */
  concurrencyKey: string | null;

  /**
   * Collapses a repeated request — a double click, a redelivered webhook, a
   * scheduler firing twice — into one job. Only held while the job is live.
   */
  dedupKey: string | null;

  priority: number;
  attempts: number;
  /** Null means retry forever. */
  maxAttempts: number | null;
  /** Earliest the job may be claimed; carries both scheduling and backoff. */
  nextRunAt: Date | null;

  lockedAt: Date | null;
  lockedBy: string | null;

  /** Cancellation is cooperative — the runner checks this between steps. */
  cancelRequestedAt: Date | null;
  pausedAt: Date | null;

  totalCount: number;
  processedCount: number;
  failedCount: number;

  payload: Record<string, unknown>;

  /** Machine-readable, e.g. `PLAN_LIMIT_EXCEEDED`, so the UI can act on it. */
  errorCode: string | null;
  errorDetails: Record<string, unknown> | null;
  lastError: string | null;

  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type JobDto = Serialized<Job>;

/**
 * One attempt at a job.
 *
 * `obsolete` marks an execution that has been superseded — a merchant edited
 * the campaign while it was running. The row is kept because it is the only
 * record of what had already reached Shopify, which is what revert works from.
 */
export interface JobExecution {
  id: string;
  shopId: string;
  jobId: string;
  /** 1-based; unique per job. */
  attempt: number;
  status: JobExecutionStatus;
  step: JobStep;
  /** Items processed within the current step, for the progress bar. */
  progress: number;
  result: Record<string, unknown> | null;
  obsolete: boolean;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type JobExecutionDto = Serialized<JobExecution>;

/**
 * One edge of the dependency graph: `jobId` waits for `dependsOnJobId`.
 *
 * Stored as a join table rather than an array so both directions are equally
 * cheap — the UI asks "what is this waiting for?" and the dispatcher asks
 * "what does finishing this release?".
 */
export interface JobDependency {
  shopId: string;
  jobId: string;
  dependsOnJobId: string;
  createdAt: Date;
}

export type JobDependencyDto = Serialized<JobDependency>;

/** The next step after `step`, or null when `step` is the last one. */
export function nextJobStep(type: JobType, step: JobStep): JobStep | null {
  const steps = JOB_STEPS[type];
  const index = steps.indexOf(step);
  if (index === -1 || index === steps.length - 1) {
    return null;
  }
  return steps[index] === undefined ? null : (steps[index + 1] ?? null);
}

/** The first step of a job type — where a fresh execution begins. */
export function firstJobStep(type: JobType): JobStep {
  const first = JOB_STEPS[type][0];
  if (first === undefined) {
    throw new Error(`job type has no steps: ${type}`);
  }
  return first;
}
