import type { Serialized } from '../serialization.js';

/**
 * A Shopify bulk operation, as this app records it.
 *
 * Bulk operations are the default path for reading and writing the catalogue:
 * a read is always `bulkOperationRunQuery`, and a write of any real size is
 * `bulkOperationRunMutation` over a staged JSONL upload. Both are asynchronous
 * — Shopify accepts the operation, runs it on its own schedule, and tells us
 * later — so the operation is a row here rather than a variable in a running
 * function. A worker that dies mid-operation must be able to pick the thread
 * back up from the database, and a job that is waiting on one must be able to
 * say what it is waiting for.
 */
export enum BulkOperationKind {
  QUERY = 'QUERY',
  MUTATION = 'MUTATION',
}

/**
 * Shopify's own status values, mirrored exactly.
 *
 * Deliberately not collapsed into our own vocabulary: this column is what we
 * compare against the API's answer when polling, and a translation layer in
 * between is one more place for the two to disagree about whether an operation
 * is finished.
 */
export enum BulkOperationStatus {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELING = 'CANCELING',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
}

/** Statuses a bulk operation never leaves. A waiting job resumes on any. */
export const TERMINAL_BULK_OPERATION_STATUSES: readonly BulkOperationStatus[] =
  [
    BulkOperationStatus.COMPLETED,
    BulkOperationStatus.FAILED,
    BulkOperationStatus.CANCELED,
    BulkOperationStatus.EXPIRED,
  ];

export function isTerminalBulkOperationStatus(
  status: BulkOperationStatus,
): boolean {
  return TERMINAL_BULK_OPERATION_STATUSES.includes(status);
}

/**
 * At or above this many variants, a write goes through
 * `bulkOperationRunMutation` instead of per-product calls.
 *
 * Below it the synchronous path wins on latency: a 40-variant campaign applies
 * in a couple of seconds, where a bulk operation would spend longer being
 * staged, queued and polled than it would spend running. Above it the
 * per-product path spends most of its life waiting on the leaky bucket.
 */
export const BULK_MUTATION_VARIANT_THRESHOLD = 500;

/**
 * The most variants carried by a single bulk mutation.
 *
 * A larger set is split into several operations, each its own child job, so a
 * failure retries one chunk rather than re-running the whole campaign.
 */
export const BULK_MUTATION_CHUNK_SIZE = 5000;

/**
 * Items per request on the synchronous path, where an item is one product
 * with its variants.
 *
 * Matches the reference implementation's `PER_REQUEST_LIMIT`. The unit is
 * products rather than variants because `productVariantsBulkUpdate` takes many
 * variants of a *single* product per call.
 */
export const SYNC_ITEMS_PER_REQUEST = 25;

/**
 * How a set of variants should be written, given its size.
 *
 * A function rather than a comparison at each call site: the threshold is a
 * commercial judgement that will be retuned against real stores, and it should
 * move in one place when it is.
 */
export function bulkWriteStrategy(variantCount: number): {
  useBulkOperation: boolean;
  chunks: number;
} {
  if (variantCount < BULK_MUTATION_VARIANT_THRESHOLD) {
    return { useBulkOperation: false, chunks: 0 };
  }
  return {
    useBulkOperation: true,
    chunks: Math.ceil(variantCount / BULK_MUTATION_CHUNK_SIZE),
  };
}

export interface BulkOperation {
  id: string;
  shopId: string;

  /** The job that started it, so a finish notification can wake that job. */
  jobId: string | null;

  /** Shopify's `gid://shopify/BulkOperation/…`. */
  shopifyBulkOperationId: string;

  kind: BulkOperationKind;
  status: BulkOperationStatus;

  /**
   * Signed JSONL result URL. **Expires one week after completion**, which is
   * why a job downloads it during the run rather than recording it for later.
   */
  url: string | null;

  /** Partial results, present when an operation failed part-way through. */
  partialDataUrl: string | null;

  /** Shopify's own error code, e.g. `ACCESS_DENIED`, `TIMEOUT`. */
  errorCode: string | null;

  objectCount: number;
  fileSize: number | null;

  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export type BulkOperationDto = Serialized<BulkOperation>;
