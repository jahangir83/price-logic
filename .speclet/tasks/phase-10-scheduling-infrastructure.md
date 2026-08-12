# Phase 10: Scheduling Infrastructure

Status: Not Started
Source: plans/03-domain-model.md #22; plans/04-user-flows.md #34-35; plans/06-product-requirements.md #36; plans/07-database.md #34

## Tasks

- [ ] **Define the `schedules` entity** — Create a schedule data model with fields `shop_id`, `operation_id`, `scheduled_at`, `timezone`, `status`, `executed_at`, `created_at`, `updated_at`. Status must be one of `SCHEDULED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`. Done when the schema exists and enforces the status enum.
- [ ] **Scope schedules to one-time and campaign-based execution only** — For MVP, a Schedule represents a single future execution time tied to one pricing operation (or a campaign start/end); do not build recurring/cron-style scheduling. Document this constraint at the model level so future recurring support is additive, not a rewrite.
- [ ] **Build the schedule creation flow** — Given an existing pricing operation configuration (target, pricing rule) plus a chosen execution date/time and timezone, let the merchant follow: Configure Pricing → Choose Date/Time → Preview → Schedule. On confirmation, persist a `schedules` row with status `SCHEDULED` linked to the operation.
- [ ] **Require minimum scheduling data before confirmation** — Validate that Operation, Target, Pricing Rule, Execution Time, and Timezone are all present before a schedule can move out of the creation flow; block confirmation otherwise.
- [ ] **Build the due-schedule detection mechanism** — Implement a mechanism (poller/worker/trigger) that identifies `SCHEDULED` schedules whose `scheduled_at` (in the stored timezone) has passed and transitions them to `PROCESSING` so exactly one execution attempt runs per schedule.
- [ ] **Implement pre-execution revalidation** — Before calculating the final price at execution time, re-fetch the current pricing inputs (e.g., latest supplier cost, current Shopify price, margin data) rather than reusing values captured at scheduling time. This is a hard requirement: stale scheduling-time data must never be blindly applied.
- [ ] **Implement the execute step: Validate → Calculate → Execute** — After revalidation succeeds, run the pricing engine to calculate the proposed price(s), apply the same validation/protection rules used elsewhere in the system, then execute the update through the normal pricing-operation execution path.
- [ ] **Record execution outcome** — On successful execution, set `executed_at` and transition status to `COMPLETED`. On failure (revalidation failure, validation failure, or execution error), transition status to `FAILED` and retain the failure reason so it is inspectable.
- [ ] **Support schedule cancellation** — Allow a merchant to cancel a `SCHEDULED` schedule before its execution time; transition it to `CANCELLED` and ensure the due-schedule detection mechanism skips cancelled schedules.
- [ ] **Guard against double execution** — Ensure the transition from `SCHEDULED` to `PROCESSING` is atomic/exclusive so a schedule cannot be picked up and executed twice if the detection mechanism runs concurrently or retries.
