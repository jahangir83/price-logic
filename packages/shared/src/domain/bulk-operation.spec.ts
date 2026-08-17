import {
  BULK_MUTATION_CHUNK_SIZE,
  BULK_MUTATION_VARIANT_THRESHOLD,
  BulkOperationStatus,
  bulkWriteStrategy,
  isTerminalBulkOperationStatus,
} from './bulk-operation.js';

describe('bulkWriteStrategy', () => {
  it('keeps a small campaign on the synchronous path', () => {
    expect(bulkWriteStrategy(0)).toEqual({ useBulkOperation: false, chunks: 0 });
    expect(bulkWriteStrategy(1)).toEqual({ useBulkOperation: false, chunks: 0 });
    expect(bulkWriteStrategy(499)).toEqual({
      useBulkOperation: false,
      chunks: 0,
    });
  });

  it('switches to a bulk operation at the threshold, not past it', () => {
    // 500 is "at or above", so the boundary case must not fall through to the
    // per-product path — that is the off-by-one this test exists for.
    expect(bulkWriteStrategy(BULK_MUTATION_VARIANT_THRESHOLD)).toEqual({
      useBulkOperation: true,
      chunks: 1,
    });
  });

  it('fits a set up to the chunk size in a single operation', () => {
    expect(bulkWriteStrategy(BULK_MUTATION_CHUNK_SIZE)).toEqual({
      useBulkOperation: true,
      chunks: 1,
    });
  });

  it('splits anything larger into whole chunks, rounding up', () => {
    expect(bulkWriteStrategy(BULK_MUTATION_CHUNK_SIZE + 1).chunks).toBe(2);
    expect(bulkWriteStrategy(12_000).chunks).toBe(3);
    // A remainder of one variant still costs a whole operation — dropping it
    // would silently leave that variant unpriced.
    expect(bulkWriteStrategy(10_001).chunks).toBe(3);
  });
});

describe('isTerminalBulkOperationStatus', () => {
  it('treats every way an operation can stop as terminal', () => {
    // A waiting job resumes on all of these. Missing one strands the job until
    // its stale-lock timeout, which is the failure this list prevents.
    expect(isTerminalBulkOperationStatus(BulkOperationStatus.COMPLETED)).toBe(
      true,
    );
    expect(isTerminalBulkOperationStatus(BulkOperationStatus.FAILED)).toBe(true);
    expect(isTerminalBulkOperationStatus(BulkOperationStatus.CANCELED)).toBe(
      true,
    );
    expect(isTerminalBulkOperationStatus(BulkOperationStatus.EXPIRED)).toBe(
      true,
    );
  });

  it('does not treat in-flight statuses as terminal', () => {
    expect(isTerminalBulkOperationStatus(BulkOperationStatus.CREATED)).toBe(
      false,
    );
    expect(isTerminalBulkOperationStatus(BulkOperationStatus.RUNNING)).toBe(
      false,
    );
    // CANCELING is a request, not an outcome: the operation is still running.
    expect(isTerminalBulkOperationStatus(BulkOperationStatus.CANCELING)).toBe(
      false,
    );
  });
});
