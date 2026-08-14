# Project Constitution

> Ground rules for this project. Injected into every speclet prompt once filled in.

## Code Quality
- ESLint + Prettier enforced across backend (NestJS) and frontend (React/Vite).
- TypeScript strict mode enabled — no `any` without explicit justification.

## Architecture Principles
- Backend organized as feature-based NestJS modules (pricing-engine, campaigns, suppliers, imports, etc.), each owning its own controller/service/entities — mirrors the phase breakdown in `tasks/`.
- No direct Shopify Admin API calls from controllers or React components — all Shopify access goes through a dedicated service/adapter layer, since it's the highest-risk external dependency (rate limits, auth, side effects).
- Schema changes ship only as version-controlled, reversible migrations — `synchronize` stays off in every environment.
- **Domain shape goes into `packages/shared` first, then the TypeORM entity (which declares `implements`), then the migration.** Never add a field to an entity alone. The entity and the admin UI's type were previously two hand-kept copies of the same shape with nothing to catch a divergence; `implements` turns drift into a compile error, but only while the shared model stays the source rather than an afterthought someone forgets to update. Entities never move into the shared package — their decorators would pull `typeorm` into the browser bundle.
- Some constraints can't be expressed with TypeORM entity decorators (notably the composite `(shop_id, parent_id) → parent(shop_id, id)` foreign keys that enforce tenant consistency). `migration:generate` diffs the DB against *entity metadata only*, so it will propose DROP statements for those constraints on every future run. Always read a generated migration before applying it and strip the spurious drop/recreate noise, keeping only the intended change.

## Domain Invariants
- **Pricing rule and campaign targeting is include + exclude, not a single scope.** A rule targets either *all products* or *specific targets*, and independently carries any number of exclusions. Both sides support targeting by product, collection, variant, tag, vendor, and product type. "All products except X" must be directly expressible. Exclusions always win over inclusions when a variant matches both.
- Campaigns reuse the pricing rule targeting model rather than defining their own.
- **Campaigns mutate product tags as a side effect, and must undo it exactly.** A campaign can add tags on activation (stripped on deactivation) and strip tags on activation (restored on deactivation). These "sale tags" are unrelated to tag *targeting*, which selects which products a rule hits.
- **Never reverse a side effect from configuration — reverse it from a record of what was actually done.** Every mutation the app makes to merchant data (tags today; the same reasoning already governs price history) is logged per affected entity, and undo replays that log. Inferring the undo from config silently destroys merchant data that happened to look like something the app set.

## Job Execution

Every multi-step operation (campaign activation, campaign deactivation/revert,
sheet parsing, sheet matching) runs as a **job**. This is the core of the
application, not plumbing bolted on beside it.

- **Postgres is the source of truth for job state — the queue is not.** No
  Redis and no BullMQ for now: `next_run_at` + `locked_at` +
  `SELECT … FOR UPDATE SKIP LOCKED` is the dispatcher. A real broker is
  expected roughly six months after launch, market-driven; when it arrives it
  replaces the *dispatch* mechanism only. Job rows stay in Postgres, so the
  swap needs no migration and loses no history. Never let queue internals
  become the only record that a job ran.
- **Campaign start and end run at concurrency 1 per shop**, enforced by the
  database rather than application logic — a `concurrency_key` column plus a
  partial unique index on `(shop_id, concurrency_key) WHERE status = 'RUNNING'`.
  Every other job type declares its own key and limit. A forgotten `WHERE`
  clause must not be able to double-apply a campaign.
- **Dependencies are job → job only. Never campaign → campaign.** A campaign
  carries no standing "runs after" relationship; ordering is a property of a
  particular execution, not of configuration. Creating or editing a campaign
  enqueues a job, and that job depends on the shop's most recent job that has
  not yet reached a terminal state — which is what makes three campaigns
  edited at once run strictly one after another, in the order the merchant
  edited them.
- **The dependency graph is navigable in both directions**: what a job depends
  on, and what depends on it. A dependent is enqueued when its dependency
  reaches a **terminal** state — SUCCEEDED *or* FAILED — because the purpose
  is ordering, not success-gating. A failed first edit must not strand the
  second one in the queue forever.
- **The `jobs` table owns execution state: which step is complete and what
  runs next.** Step order is defined per job type in code; the row records the
  current step and a cursor for resuming inside it. There is no separate step
  table — batching granularity comes from child jobs, so a second table would
  record the same progress twice and give two places for it to disagree.
- **The dependency graph exists for billing, duplicate resolution, and
  serialising concurrent merchant edits.** Do not remove it later as
  "unnecessary complexity" — these are the reasons it is there.
- **A job may spawn child jobs, and a parent completes only when every child
  reaches a terminal state.** This is how large work is executed: the parent
  resolves targets, then spawns one child per batch so each batch fits the
  Shopify leaky bucket on its own and can retry alone without re-running the
  whole campaign.
- **Pause, resume and cancel are first-class, and cancellation is
  cooperative.** A running job is asked to stop via `cancel_requested_at` and
  checks that flag between steps and between batches. A job is never killed
  mid-mutation — that leaves a half-applied campaign with no record of what
  was already written to Shopify, which is exactly the state undo cannot
  recover from.

## Billing & Plan Limits

Plans: Free 50 / Starter 2,000 / Plus 20,000 / Professional unlimited
**product variants on sale**.

- **The quota is a concurrent ceiling, not metered monthly usage.** "Variants
  on sale" means variants affected by campaigns that are active *right now*.
  A merchant who runs and reverts a 40-variant campaign ten times has used 40
  of their quota, not 400.
- **The count is shop-wide and distinct, never per campaign.** Two 30-variant
  campaigns exceed the Free plan's 50 even though neither does alone, and a
  variant touched by two campaigns counts once.
- **The check runs before the first Shopify mutation** — during target
  resolution, before any push step and before child jobs are spawned. A quota
  failure must never leave a partially applied campaign, which is the one
  outcome a merchant cannot understand or undo themselves.
- **Over the limit blocks the whole campaign; it never applies partially.**
  Applying the first 50 of 60 variants and silently dropping the rest leaves
  the merchant unable to tell which products are on sale.
- **The job stops with a machine-readable code** (`PLAN_LIMIT_EXCEEDED`) plus
  the limit and the required count, so the UI can show an upgrade prompt
  rather than a generic failure.
- **A downgrade never retroactively stops a running campaign.** The limit
  gates new activations only.
- **Plan limits live in `@pricelogic/shared`** so the pricing page, the usage
  meter and the server-side enforcement all read the same numbers. A limit
  that exists in two places will eventually disagree, and the disagreement is
  revenue.
- Concurrency 1 per shop on campaign start/end is what makes the quota check
  race-free: two activations cannot both pass the check and then both apply.
  This is a second reason that rule exists — do not relax it for throughput.

## Testing Requirements
- Jest for unit tests on all business logic, with full coverage required on the pricing engine specifically (flagged as the highest-risk, most-tested component in the task breakdown).
- Integration tests for API endpoints via NestJS's testing module against a real PostgreSQL test database.
- No mandated blanket coverage percentage — core money-calculation paths must be fully covered regardless.
- Schema/migration work is not done until the migration has actually been run (and reverted) against a real PostgreSQL instance and the app has booted against the resulting schema. If no database credentials are available, initialize a throwaway cluster with `initdb`/`pg_ctl` rather than skipping the check — build, lint, and mocked unit tests cannot catch bad constraint syntax, missing extensions, or DI wiring that only fails at real bootstrap.

## What To Avoid
- Never use JS floats for currency — decimal types only, end-to-end (DB, TypeORM entities, API payloads).
- Never trust client-supplied prices/costs for execution — always recalculate server-side before any mutation.
- Never start an `npm install` in a directory where another one is still running. Wait for the first to exit (check it, don't assume) — a concurrent install rewrites `package.json`/`package-lock.json` on completion and silently discards the other's additions.
- **Never hand-clean a partially installed `node_modules`.** When an install dies part-way, delete the whole tree and reinstall; never remove individual temp directories to get past an `ENOTEMPTY`, and never re-run install over a half-extracted tree. npm sees the directory present and skips re-extracting it, so the tree looks complete but is not — `@nestjs/common` was left with its `.js` files and no `.d.ts`, surfacing as ~45 bogus "has no exported member 'Module'" errors, and `@shopify/polaris-icons` as 144 unresolved imports at bundle time. Both look like code bugs and are not.

## Definition of Done
A task is done when:
- Code is implemented per the task description.
- Relevant unit/integration tests are written and passing.
- ESLint/Prettier are clean.
- The task checkbox is marked `- [x]` in its phase file.
