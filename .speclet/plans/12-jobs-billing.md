# PriceLogic — Job Execution & Billing Layer

> Plan created via /speclet-plan on 2026-08-14.
>
> **Extends `11-campaign-supplier-mvp.md`; supersedes nothing.** The 8-table
> campaign schema in that plan describes *what a campaign is*. It has no
> representation of *how a campaign runs* — no record of an execution attempt,
> no retry state, no concurrency control — and no billing at all. This plan
> adds both.

---

## Why this exists

The re-baselined schema is complete for **state** and empty for **execution**.
`campaigns.status` is a single mutable field, so activate → fail at 40% →
retry → succeed leaves no trace of the first attempt. Steps that write no rows
(resolving targets, fetching prices) are invisible if the process dies. There
is no attempt counter, no backoff, no claim, and nothing preventing two
workers from processing the same campaign.

The previous 17-table schema actually had some of this — `pricing_operations`
carried `QUEUED`/`PROCESSING`, progress counters and an `idempotency_key`. The
re-baseline traded it away to put status on `campaigns`. That was right for
state and wrong for execution, so this restores it in a better shape.

Billing is not deferrable either: the plan limit is enforced *inside* job
execution, so the two land together or the quota check has nowhere to live.

## Decisions taken

### 1. A job is the intent; a job execution is one attempt at it

`jobs` holds what should happen — name, payload, schedule, priority, retry
policy, dependencies. `job_executions` holds each run — current step, try
count, progress, result. One job has many executions.

*Alternative considered and rejected:* keeping step state as columns on the
job row. Simpler, but a retry overwrites its own history, and "what did
attempt 1 do before it died?" becomes unanswerable — which is exactly the
question asked after a half-applied campaign.

A superseded execution is marked `obsolete`, never deleted. When a merchant
edits a campaign mid-run, the in-flight execution is flagged and a new one
supersedes it; deleting it would destroy the record of what already reached
Shopify, which is the only thing revert can work from.

### 2. Postgres is the queue; the broker comes later

`next_run_at` + `locked_at` + `SELECT … FOR UPDATE SKIP LOCKED`. No Redis, no
BullMQ for launch.

The important part is the boundary: **job rows are the source of truth, the
broker is only dispatch.** When BullMQ arrives (expected ~6 months post-launch,
market-driven) the job row gains a `broker_job_id` and nothing else changes —
no migration, no lost history. Never let queue internals become the only
record that a job ran.

### 3. Campaign start and end run at concurrency 1 per shop

Enforced by the database, not application logic:

```sql
CREATE UNIQUE INDEX ON jobs (shop_id, concurrency_key)
  WHERE status = 'RUNNING';
```

Every job type declares its own `concurrency_key`. A forgotten `WHERE` clause
must not be able to double-apply a campaign.

This rule is load-bearing twice over: it also makes the plan-limit check
race-free, since two activations cannot both pass the quota check and then
both apply. It must not be relaxed for throughput.

### 4. Dependencies are job → job, never campaign → campaign

A campaign carries no standing "runs after" relationship — ordering is a
property of a particular execution, not of configuration. Creating or editing
a campaign enqueues a job, and that job depends on the shop's most recent job
that has not yet reached a terminal state. That is what makes three campaigns
edited at once run strictly one after another, in the order the merchant
edited them.

A dependent is released when its dependency reaches a **terminal** state —
succeeded *or* failed. The purpose is ordering, not success-gating; a failed
first edit must not strand the second one forever.

The graph is navigable both ways (`job_dependencies` keyed on
`(job_id, depends_on_job_id)` with an index on the second column), because the
UI needs "what is this waiting for?" and the dispatcher needs "what does
finishing this release?".

### 5. Jobs spawn child jobs

A parent resolves targets, then spawns one child per batch so each batch fits
Shopify's leaky bucket on its own and can retry alone without re-running the
whole campaign. The parent completes only when every child reaches a terminal
state.

### 6. Cancellation is cooperative

A running job is asked to stop via `cancel_requested_at` and checks that flag
between steps and between batches. A job is never killed mid-mutation — that
leaves a half-applied campaign with no record of what already reached Shopify,
which is precisely the state undo cannot recover from. Pause and resume work
the same way.

### 7. Every job carries a deduplication key

A double click, a webhook redelivery and a scheduler firing twice must collapse
into one job rather than two competing executions.

### 8. Billing is a concurrent ceiling on variants, not metered usage

Free 50 / Starter 2,000 / Plus 20,000 / Professional unlimited **variants on
sale**. "On sale" means affected by a campaign active *right now* — a merchant
who runs and reverts a 40-variant campaign ten times has used 40 of their
quota, not 400.

The count is **shop-wide and distinct**, never per campaign. Two 30-variant
campaigns exceed the Free plan's 50 even though neither does alone, and a
variant touched by two campaigns counts once.

The check runs before the first Shopify mutation and blocks the **whole**
campaign. Applying the first 50 of 60 and dropping the rest leaves the merchant
unable to tell which products are on sale. Failure sets a machine-readable
`PLAN_LIMIT_EXCEEDED` with the limit and required counts, so the UI can render
an upgrade prompt with real numbers rather than a generic error.

### 9. Plans live in the database; limits are overridable per shop

*Alternative considered and rejected:* plan limits as constants in
`@pricelogic/shared`. Rejected because a per-store override — an enterprise
deal, a support gesture, a grandfathered merchant — cannot be a code constant,
and prices change for commercial reasons that should not require a deploy.

`@pricelogic/shared` owns the plan *handle* enum and the DTOs; the numbers
come from `app_plans`, with nullable override columns on `shops` taking
precedence where present.

### 10. Usage counters are a cache for the UI; enforcement recomputes

`store_usage` keeps `active_variant_count` and `active_campaign_count` so the
meter renders without a scan, and carries `last_reconciled_at` because a
denormalized counter always drifts. The quota check at activation recomputes
from `price_changes` — it runs once per activation, already holds the shop's
concurrency lock, and is gating revenue.

### 11. Billing state is append-only

Every upgrade, downgrade, renewal and cancellation is a row in
`store_subscription_events` with its from/to plan. Merchants dispute charges,
and the current row alone cannot answer "what was I on when this was billed?"

## Target schema

Seven new tables, folded into the (still unreleased) Phase 1 migration rather
than added as a follow-up:

| Table | Purpose |
| --- | --- |
| `jobs` | intent: type, status, `parent_job_id`, `concurrency_key`, `dedup_key`, priority, `max_attempts`, `next_run_at`, `locked_at`/`locked_by`, `cancel_requested_at`, `paused_at`, payload |
| `job_executions` | one attempt: step, tries, progress, result, `obsolete` |
| `job_dependencies` | PK `(job_id, depends_on_job_id)` + index on the second |
| `app_plans` | handle, name, prices, interval, trial days, `active_variant_limit`, `active_campaign_limit` (null = unlimited) |
| `store_subscriptions` | plan, `shopify_subscription_gid`, status, period and trial dates, grace period |
| `store_subscription_events` | append-only audit: type, from/to plan, payload |
| `store_usage` | `active_variant_count`, `active_campaign_count`, `last_reconciled_at` |

Column changes to existing tables:

- `shops` — nullable plan-limit override columns
- `campaigns` — `round_strategy` (UP / DOWN / NEAREST) and the overlap policy
- `price_changes`, `product_tag_changes` — `job_id`, with the unique index
  moving from `(campaign_id, variant)` to `(job_id, variant)`

That last change fixes a live bug. The current unique index allows exactly one
row per campaign per variant *forever*, so a second activation must overwrite
the first run's `old_price` — losing the price the variant had before the
first activation, and with it the ability to revert to it. Keying on the
execution instead keeps the retry guard exactly as strong within a run while
making re-runs genuinely additive.

**Not ported** from the reference schema reviewed on 2026-08-14: the four
discount-code tables, bulk-operation tracking, timer widgets, announce bars,
and catalog mirroring (`Product`/`ProductVariant`/`Collection`) — we read the
catalog live by design.

## The overlap problem

When two active campaigns target the same variant, two questions arise and only
the first is obvious.

**On apply:** which price wins — the larger discount, or the most recently
activated campaign?

**On revert:** campaign A (20%) is active; B (30%) activates and overwrites the
price. A ends. A's revert would restore the pre-A price and silently
un-discount a variant that B still owns and still advertises.

The second is the harder half and the current schema cannot express it at all.
The resolution is that revert must not blindly restore `old_price`; it must
recompute from whichever campaigns still hold the variant.

That is why the recommendation is **largest discount wins**: it is
order-independent, so the correct price is always recomputable from the set of
currently-active campaigns. "Most recent wins" is order-dependent, which means
after a revert there is no way to know what the price *should* be without
replaying history. It is also the safer customer-facing default — the
storefront never shows a worse price than an advertised campaign.

---

## Phase J1 — Job & Billing Schema

Shared domain models and enums for jobs, executions, dependencies, plans,
subscriptions and usage. Backend entities implementing them. The seven tables
and the column changes folded into the existing re-baseline migration, with
the composite tenant foreign keys and the partial unique index that enforces
concurrency. Constraint tests proving the concurrency index actually rejects a
second RUNNING job for the same key, that the dependency graph is navigable
both ways, and that the re-run collision is gone.

No services — this phase is the shape only, verified against a real
PostgreSQL instance per the constitution.

## Phase J2 — Job Engine & Dispatcher

The business logic, all of it independent of Shopify and therefore fully
testable now: enqueue with deduplication, dependency resolution and release on
terminal state, claiming with `SKIP LOCKED` under the concurrency constraint,
the execution lifecycle (start, advance step, record progress, complete, fail,
retry with backoff, exhaust attempts), cooperative pause/resume/cancel, child
job spawning and parent completion, and marking superseded executions obsolete.

Plus the dispatcher loop itself and its shutdown behaviour — a worker that
stops must release its claims rather than leaving jobs locked until a timeout.

## Phase J3 — Plan Limits, Usage & Overlap Resolution

Plan lookup with per-shop overrides. The quota recomputation and its placement
inside activation, before any mutation and before children are spawned.
`PLAN_LIMIT_EXCEEDED` as a structured, machine-readable failure. Usage counter
maintenance and periodic reconciliation. Overlap resolution on both apply and
revert, including the recompute-from-remaining-campaigns rule.

This is where the money-path unit coverage the constitution demands is
concentrated, alongside the price calculator.

## Phase J4 — Shopify Billing Integration

`appSubscriptionCreate`, the confirmation return flow, and the
`APP_SUBSCRIPTIONS_UPDATE` webhook driving subscription status. Trial
handling, grace periods, upgrade and downgrade paths, and the event trail.

Isolated deliberately as the last phase: it is the only part of this plan that
cannot be verified without real Shopify credentials and a development store,
which the current `.env` does not have.

---

## Ordering

```
MVP Phase 1 (schema, done) ──> J1 ──> J2 ──┬──> J3 ──> MVP Phase 6 (activation)
                                            └──> J4
```

J1 must land while the re-baseline migration is still unreleased, or `job_id`
becomes nullable forever and the re-run bug ships. J2 and J3 gate MVP Phase 6,
which is the first phase that writes to Shopify. J4 is independent of both and
can run in parallel once credentials exist.

J1–J3 are unblocked today. J4 is blocked on a development store.

## Open decision

**Overlap policy default and scope.** Recommendation above is largest-discount-
wins, settable as a shop default with a per-campaign override — matching the
reference app's `dublicateProductApply`. Confirm, or choose most-recent-wins
and accept that revert becomes history-dependent.
