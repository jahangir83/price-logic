# Multi-step jobs and Shopify bulk operations

Status: Complete (unverified against a real store)
Completed: 2026-08-16
Source: not from a plan document — the FlashX-shaped job model asked for on
2026-08-16, captured as pending rules 3–5 in `constitution.learned.md`.
Branch: `mvp-schema-rebaseline`

> The job engine from J2 walked a step sequence but kept no record of what each
> step produced, and every price write went through `productVariantsBulkUpdate`
> one product at a time. This makes a step a unit of work, and makes bulk
> operations the path for anything of size.

## ⚠ Outstanding — needs a development store

Nothing here has touched a real Shopify store. The parts that cannot be
verified without one:

- `stagedUploadsCreate` → multipart upload → `bulkOperationRunMutation`. The
  upload is a hand-built form because the parameters must be appended in order
  with the file last; if that ordering is wrong, S3 rejects it.
- The exact shape of a bulk **mutation's** JSONL result. `interpretBulkResults`
  is written against the documented shape (one line per invocation, carrying
  `data` and `__lineNumber`) and unit-tested against it, but the shape itself
  is assumed.
- Whether `BULK_OPERATIONS_FINISH` registers cleanly on install.
- Which API version we actually send. `configuration.ts` defaults to `2026-07`,
  `env.validation.ts` and the client both fall back to `2025-01`, and the
  answer decides whether we get one or five concurrent bulk queries.

## Tasks

- [x] **Model bulk operations in `@pricelogic/shared`** — `BulkOperation`,
  `BulkOperationKind`, `BulkOperationStatus` mirroring Shopify's own values, the
  terminal-status set, and the three numbers the policy turns on:
  `BULK_MUTATION_VARIANT_THRESHOLD` (500), `BULK_MUTATION_CHUNK_SIZE` (5,000),
  `SYNC_ITEMS_PER_REQUEST` (25). `bulkWriteStrategy()` is the one place the
  threshold is applied, because it is a commercial judgement that will be
  retuned against real stores. 6 unit tests.

- [x] **Add `JobStepResult` to the shared model and `JobStatus.WAITING_BULK`** —
  a step is a unit of work with its own status, `tries` and result, not a
  cursor. WAITING_BULK is distinct from PAUSED: a paused job waits for a
  merchant, this one resumes by itself.

- [x] **Migration `1787400000000-JobStepResultsAndBulkOperations`** — creates
  `job_step_results` (unique on `(job_id, step)`) and `bulk_operations` (unique
  on `shopify_bulk_operation_id`, so a redelivered webhook finds the same row),
  adds `jobs.bulk_operation_id`, and rebuilds `jobs_status_enum`. The enum is
  rebuilt rather than extended with `ADD VALUE` because a value added that way
  cannot be *used* in the same transaction, and `UQ_jobs_live_dedup_key` has to
  be recreated including WAITING_BULK in the same migration. **Run and reverted
  against the real database**, and the app booted against the result.

- [x] **Per-step results in the engine** — `beginStep`, `finishStep`,
  `stepResult`, `stepResults` on `JobsService`; `advanceToStep` closes the step
  it leaves and opens the one it enters; `complete` closes the final step with
  the job's result; `fail` records *which* step failed and with what. Exposed to
  handlers as `context.recordStep()` / `context.stepResult()`.

- [x] **Fixed a latent bug in `claimNext`** — `reclaimStale` hands the attempt
  back without consuming it, so the next claim reuses the attempt number and the
  `job_executions` insert violates `UQ_job_executions_job_attempt`. That insert
  sits outside the claim's own error handling, so it threw out of the dispatcher
  tick and left the job unclaimable in a loop. The existing execution row is now
  resumed, keeping the step it reached. Parking on bulk operations would have
  hit this on every resume.

- [x] **`BulkOperationService`** — `runQuery`, `runMutation` (staged JSONL
  upload), `refresh`, and `readResults` as an async generator that streams the
  JSONL rather than buffering it, because these files run to hundreds of
  megabytes inside a worker that has other jobs to serve. Credentials come from
  the shop record — the offline token — because the operation and its result
  outlive the request that started it.

- [x] **Job parking and resume** — `parkOnBulkOperation` sets WAITING_BULK and
  releases the worker and the shop's concurrency key, since holding them for the
  minutes an operation takes would idle the pool and block the shop.
  `resumeFromBulkOperation` fires on **every** terminal status, not just
  COMPLETED, and does not charge an attempt. WAITING_BULK is in
  `LIVE_JOB_STATUSES`, so a parked job keeps holding its dedup key.

- [x] **`bulk_operations/finish` webhook** — plus `BULK_OPERATIONS_FINISH` in
  the registrar. The coordinator lives in the webhooks module rather than in
  either module it joins, keeping the engine ignorant of Shopify and the Shopify
  adapter ignorant of jobs. The webhook payload's status is not trusted on its
  own: the operation is re-read from the API, because otherwise `url` would be
  null on a COMPLETED operation and the woken job would find nothing to
  download.

- [x] **A backstop sweep** — a job parked on an operation whose webhook never
  arrived would wait forever: WAITING_BULK is not claimable, so it never trips
  the stale-lock check either. Sweeps every 60s (`JOBS_BULK_SWEEP_MS`).

- [x] **The size switch in activation** — at or above 500 variants a run
  submits one 5,000-variant chunk as a bulk mutation and parks; below it, the
  per-product path is unchanged. One chunk per run, not all of them: Shopify
  runs a single bulk mutation per shop at a time, so the queue is the loop,
  which is what lets a worker restart mid-campaign without losing its place.
  A parked run does **not** push tags or call the campaign ACTIVE.

- [x] **`bulk-price-writer.ts`** — the chunking and result interpretation, kept
  pure and unit-tested (13 tests) because they are what cannot be tested against
  a real store without applying real prices to a real storefront. A product is
  never split across chunks, since two invocations writing one product would
  race. Anything Shopify does not explicitly confirm is **not** marked APPLIED.

- [x] **Tests** — 17 new e2e cases in `job-engine.e2e-spec.ts` covering step
  results and the park/resume cycle, plus 19 new unit tests. Full suite: 320
  unit, 243 e2e, all passing; ESLint and `tsc --noEmit` clean.

## What is not done

- **Reads still do not use `bulkOperationRunQuery`.** The rule says every
  catalogue read should, and `BulkOperationService.runQuery` exists, but
  `TargetResolverService` and the preview still paginate `products(first:…)`.
  Switching them turns a synchronous read the merchant is waiting on into an
  asynchronous one, which changes the preview screen's behaviour, not just its
  plumbing — that is its own piece of work.
- **Multi-chunk campaigns are untested end to end.** The code submits chunk 1,
  parks, absorbs, then submits chunk 2 on the next run; nothing exercises the
  second lap, because doing so needs either a real store or a fake that models
  Shopify's asynchronous behaviour.
