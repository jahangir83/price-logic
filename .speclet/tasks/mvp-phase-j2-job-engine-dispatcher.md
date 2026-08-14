# Phase J2: Job Engine & Dispatcher

Status: Complete
Completed: 2026-08-14
Source: plans/12-jobs-billing.md — Phase J2
Depends on: J1 (schema) — Complete

> Task list derived from the plan's Phase J2 section; there was no task file,
> so it was written here rather than blocking on `/speclet-tasks`.

All of this is independent of Shopify and therefore fully testable now, which
is why it comes before the phases that need a development store.

## Tasks

- [x] **Retry backoff** — exponential with jitter, as a pure function so it can
  be tested without a clock. Capped, because a job that keeps failing should
  settle into a slow retry rather than an ever-longer one.

- [x] **Enqueue with deduplication** — creating a job returns the existing live
  job when one already holds the dedup key, rather than raising. A double
  click must be indistinguishable from a single one to the caller.

- [x] **Dependency edges and serialized enqueue** — a job with dependencies
  starts BLOCKED; `enqueueSerialized` chains a new job behind the shop's most
  recent non-terminal job, which is what makes three campaigns edited at once
  run in the order the merchant edited them.

- [x] **Claiming with SKIP LOCKED** — the dispatcher's candidate query skips
  jobs whose concurrency key is already RUNNING, takes the highest priority
  first, and never blocks behind another worker. The partial unique index
  stays the backstop for the race the query cannot close.

- [x] **Execution lifecycle** — starting a claim opens a `job_executions` row
  at the type's first step; advancing records the step and resets progress;
  completing and failing close both the execution and the job.

- [x] **Retry and attempt exhaustion** — a retryable failure returns the job to
  PENDING with a backoff; a non-retryable one, or exhausting `maxAttempts`,
  fails it terminally. `PLAN_LIMIT_EXCEEDED` is never retried — the answer will
  not change on its own.

- [x] **Dependency release on terminal state** — succeeded *or* failed releases
  dependents, because the purpose is ordering rather than success-gating.

- [x] **Cooperative pause, resume and cancel** — cancellation sets a flag the
  runner observes between steps; a RUNNING job is never killed mid-mutation.

- [x] **Child jobs and parent completion** — a parent that spawns children
  moves to WAITING_CHILDREN and finishes only when every child is terminal,
  failing if any child failed.

- [x] **Superseding an in-flight execution** — marks the current execution
  obsolete and leaves it in place, because it is the only record of what
  already reached Shopify.

- [x] **Reclaiming a crashed worker's jobs** — a RUNNING job whose lock has
  gone stale returns to PENDING without consuming an extra attempt.

- [x] **The dispatcher loop and graceful shutdown** — polls, runs registered
  handlers, and on shutdown stops taking work and releases its claims rather
  than leaving them locked until the stale-lock timeout.

- [x] **Handler contract and registry** — job types register a handler; the
  engine knows nothing about Shopify. Real handlers arrive in later phases.

- [x] **Tests** — pure unit tests for backoff and the registry, plus
  integration tests against real PostgreSQL for everything that depends on
  `SKIP LOCKED`, partial unique indexes or transaction boundaries, since none
  of those can be exercised against a mock.

## Verification

PostgreSQL 16.14 (throwaway cluster). Everything that depends on
`SKIP LOCKED`, a partial unique index or a transaction boundary is covered by
integration tests, because a mocked repository would happily confirm a design
that deadlocks or double-applies.

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (69 files) | 0 errors, 0 warnings |
| backend: unit tests | 37 passed, 7 suites |
| backend: integration tests | 66 passed, 4 suites |
| shared: unit tests | 82 passed, 4 suites |

Behaviour proven rather than asserted in a comment:

- a repeated enqueue returns the **same** job; the key frees once it is terminal
- the same dedup key in two shops creates **two** jobs
- three serialized edits claim strictly in order, and a **failed** first edit
  still releases the second
- the highest priority is claimed first; a future `nextRunAt` is not claimed
- a second job sharing a concurrency key waits; **another shop is unaffected**
- two concurrent `claimNext` calls yield exactly **one** claim
- a retry backs off, and each attempt keeps its own execution row
- `PLAN_LIMIT_EXCEEDED` is **never** retried, whatever `maxAttempts` says
- a running job is only **flagged** for cancellation, never killed
- a superseded execution is kept and marked obsolete
- a parent waits for every child and fails if any child failed
- a stale claim returns to the queue **without** consuming an attempt
- shutdown releases this worker's claims instead of waiting for the timeout

## Notes for the next phase

- **No real handlers exist yet.** `JobHandlerRegistry` is wired and the
  contract is fixed; J3 and MVP Phase 6 register the handlers that talk to
  Shopify. A job whose type has no handler fails immediately with `NO_HANDLER`
  rather than retrying, so a missing registration is loud.
- **`jest-e2e.json` now runs with `maxWorkers: 1`.** The suites share one
  database and `claimNext` is deliberately global, so parallel files made
  results depend on file order.
- The dispatcher is disabled by `JOBS_DISPATCHER_ENABLED=false`; tests drive
  `tick()` directly rather than waiting on a timer.
