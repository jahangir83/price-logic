# Phase J1: Job & Billing Schema

Status: Complete
Completed: 2026-08-14
Source: plans/12-jobs-billing.md — Phase J1
Branch: `mvp-schema-rebaseline`

> Folded into the (still unreleased) re-baseline migration rather than added as
> a follow-up. `price_changes.job_id` is `NOT NULL`, which is trivial before any
> data exists and painful after.

## Tasks

- [x] **Add the job domain models to `@pricelogic/shared`** — `Job`,
  `JobExecution`, `JobDependency`, plus `JobType`, `JobStatus`,
  `JobExecutionStatus` and `JobStep`. `JOB_STEPS` defines the step order per
  job type in one place, with `CHECK_PLAN_LIMIT` sitting after target
  resolution and before every step that mutates Shopify.

- [x] **Add the billing domain models** — `AppPlan`, `StoreSubscription`,
  `StoreSubscriptionEvent`, `StoreUsage` and `ResolvedPlanLimits`.
  `resolvePlanLimits` applies shop overrides, where **null means "use the plan
  default", not unlimited** — the distinction that makes overrides safe to
  leave null.

- [x] **Add `DuplicatePolicy` and the overlap resolver** — `HIGHEST_DISCOUNT`
  (default), `LATEST`, `SKIP`. The enum lives on the campaign model; the
  resolver in `pricing/overlap.ts` consumes it. Covers **both** halves:
  `resolveOverlap` for which claim wins while campaigns overlap, and
  `resolveAfterRelease` for what a variant becomes when one campaign ends —
  the half blind reverting gets wrong.

- [x] **Add the quota rule** — `checkPlanQuota` returns a structured
  `PLAN_LIMIT_EXCEEDED` violation carrying limit, current and required, so the
  UI renders an upgrade prompt with real numbers instead of parsing a string.

- [x] **Write the `jobs`, `job_executions` and `job_dependencies` entities** —
  implementing the shared models. Job is the intent, execution is one attempt.

- [x] **Write the four billing entities** — `app_plans` is the only table in
  the schema that is not shop-scoped; it is catalogue data we own.

- [x] **Extend `shops` and `campaigns`** — `shops` gains `duplicate_policy`
  and two nullable override columns; `campaigns` gains `round_strategy`
  (UP/DOWN/NEAREST) and a nullable `duplicate_policy` override. The Shop
  domain model moved into `@pricelogic/shared` at the same time, deliberately
  **without** `accessTokenEncrypted` so ciphertext cannot be serialized into a
  response by accident.

- [x] **Move the change tables onto `job_id`** — uniqueness is now
  `(job_id, variant)` instead of `(campaign_id, variant)`. Fixes a live bug:
  the old key allowed exactly one row per campaign per variant *forever*, so a
  second activation had to overwrite the first run's `old_price` and destroy
  the price revert would need to restore.

- [x] **Fold seven tables into the migration** — with composite tenant foreign
  keys throughout, CASCADE only for executions and dependency edges (which are
  meaningless without their job), and RESTRICT on `price_changes.job_id` so
  deleting a job cannot silently delete the record of what to put back.

- [x] **Add the partial unique indexes** — `UQ_jobs_running_concurrency_key`
  enforces concurrency 1 per shop per key in the database; `UQ_jobs_live_dedup_key`
  holds a dedup key only while a job is live, so the same work stays
  legitimately repeatable later.

- [x] **Seed the plan catalogue** — Free 50 / Starter 2,000 / Plus 20,000 /
  Professional unlimited, with prices in integer cents.

- [x] **Run up, down and up again against real PostgreSQL** — verified below.

- [x] **Prove the constraints by test** — `test/job-constraints.e2e-spec.ts`,
  15 tests, driving raw SQL because the point is that the *database* refuses.

## Verification

PostgreSQL 16.14 (throwaway cluster, `initdb`/`pg_ctl`):

| Check | Result |
| --- | --- |
| shared: build / typecheck | pass |
| shared: unit tests | 82 passed, 4 suites |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (63 files) | 0 errors, 0 warnings |
| backend: unit tests | 30 passed, 6 suites |
| backend: integration tests | 27 passed, 3 suites |
| frontend: `tsc -b` / `vite build` | pass |
| Migration up → 16 tables + 4 seeded plans | pass |
| `migration:revert` → `shops` + `migrations` | pass (incl. the new `shops` columns) |
| Migration up again | pass, reproducible |

Constraints proven by test rather than asserted in a comment:

- a second RUNNING job for the same `(shop, concurrency_key)` is **rejected**
- a different shop **can** run its own campaign concurrently — the limit is
  per shop, never global
- queued jobs sharing a key are **allowed**; only RUNNING is constrained
- finishing a job **frees** its concurrency key and its dedup key
- a repeated request while the first job is live is **rejected**
- a job depending on itself is **rejected**
- a dependency crossing shops is **rejected**
- the graph is navigable in **both** directions
- two executions with the same attempt number are **rejected**
- a job claiming both a campaign and an import is **rejected**
- a re-run **can** now touch a variant its earlier run already touched — the
  bug this phase fixes
- a negative plan limit and a duplicate plan handle are **rejected**

## Notes for the next phase

- **`round_strategy` defaults to `UP`**, which matches the column's original
  documented behaviour but gives back most of a discount when a price lands on
  a whole number (a 20% discount reaching 11.00 becomes 11.99). `NEAREST` is
  implemented and tested. Worth revisiting with a merchant in front of it.
- **The overlap resolver is written but nothing calls it yet.** J3 wires it
  into activation and revert; until then, two campaigns targeting one variant
  still race.
- `store_usage` is created but never written — J3 owns reconciliation.
