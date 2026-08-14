import { Injectable, Logger } from '@nestjs/common';
import { JobStep, JobType } from '@pricelogic/shared';
import { Job } from './entities/job.entity';

/**
 * What a handler is given, and what it is allowed to do to its own job.
 *
 * Deliberately narrow. A handler reports progress and asks whether it should
 * stop; it does not set the job's status, because deciding whether a failure
 * retries is the engine's business and a handler that could mark itself
 * SUCCEEDED could do so with half the work done.
 */
export interface JobContext {
  job: Job;
  /** Advance to the next step in this job type's sequence. */
  advance(): Promise<JobStep | null>;
  advanceTo(step: JobStep): Promise<void>;
  report(counts: {
    processed?: number;
    failed?: number;
    total?: number;
  }): Promise<void>;
  /**
   * True once cancellation has been requested.
   *
   * Handlers must check this between steps and between batches. That check is
   * the entire cancellation mechanism — a running job is never killed, because
   * stopping mid-mutation leaves a half-applied campaign with no record of
   * what already reached Shopify.
   */
  shouldStop(): Promise<boolean>;
  /** Hand the remaining work to child jobs and finish this one. */
  spawnChildren(specs: ChildJobSpec[]): Promise<void>;
}

export interface ChildJobSpec {
  type: JobType;
  payload?: Record<string, unknown>;
  campaignId?: string | null;
  csvImportId?: string | null;
  concurrencyKey?: string | null;
  priority?: number;
}

export interface JobHandler {
  readonly type: JobType;
  run(context: JobContext): Promise<JobResult | void>;
}

export interface JobResult {
  /** Merged into the execution's `result` column. */
  result?: Record<string, unknown>;
  /** Set when the handler delegated its work to children. */
  spawnedChildren?: boolean;
}

/**
 * A failure the handler knows will not fix itself.
 *
 * Throwing this rather than a plain Error tells the engine not to burn the
 * remaining attempts — a plan-limit rejection means the same thing on the
 * fifth try as on the first.
 */
export class PermanentJobError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * Maps a job type to the handler that runs it.
 *
 * The engine knows nothing about Shopify, campaigns or sheets; it knows how to
 * claim, retry and finish work. Registering handlers here is what keeps that
 * boundary — the phases that add Shopify code add handlers, not engine code.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly logger = new Logger(JobHandlerRegistry.name);
  private readonly handlers = new Map<JobType, JobHandler>();

  register(handler: JobHandler): void {
    if (this.handlers.has(handler.type)) {
      // Two handlers for one type means a silent coin flip over which runs.
      throw new Error(`A handler is already registered for ${handler.type}`);
    }
    this.handlers.set(handler.type, handler);
    this.logger.log(`Registered job handler for ${handler.type}`);
  }

  get(type: JobType): JobHandler | undefined {
    return this.handlers.get(type);
  }

  has(type: JobType): boolean {
    return this.handlers.has(type);
  }

  /** Registered types, for the dispatcher's startup log. */
  types(): JobType[] {
    return [...this.handlers.keys()];
  }
}
