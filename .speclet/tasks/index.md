# Task Index

> Phases group related spec sections from across `.speclet/plans/*.md` into real
> implementation units (not a 1:1 mapping to plan doc headings).

## Active phases — Campaign & Supplier MVP

Source plan: `plans/11-campaign-supplier-mvp.md`. Eight phases replacing the
8-table schema redesign agreed on 2026-08-12. Phase 1 must land before any
other phase starts.

- **1. Schema Re-baseline** → `tasks/mvp-phase-01-schema-re-baseline.md`
- **2. Live Shopify Catalog Access** — **Complete** (unverified against a real store) → `tasks/mvp-phase-02-live-shopify-catalog-access.md`
- **3. Campaign Builder & Targeting** — **Complete** → `tasks/mvp-phase-03-campaign-builder-targeting.md`
- **4. Price Calculation & Preview** — **Complete** → `tasks/mvp-phase-04-price-calculation-preview.md`
- **5. Supplier Sheet Upload & Approval** — **Complete** → `tasks/mvp-phase-05-supplier-sheet-upload-approval.md`
- **6. Activation — Applying Changes to Shopify** — **Complete** (unverified against a real store) → `tasks/mvp-phase-06-activation.md`
- **7. Deactivation, Revert & Scheduling** — **Complete** (unverified against a real store) → `tasks/mvp-phase-07-deactivation-revert-scheduling.md`
- **8. Dashboard, Hardening & Launch Readiness** — **Complete** (compliance check needs a dev store) → `tasks/mvp-phase-08-dashboard-hardening-launch.md`

### Dependencies

```
1 Schema  ──┬──> 2 Catalog ──┬──> 3 Builder ──> 4 Calculation ──┬──> 6 Activation ──> 7 Revert ──> 8 Launch
            │                └──> 5 Sheet Upload ───────────────┘
            └──> everything (nothing starts before the migration lands)
```

Phases 3 and 5 are the two ways a campaign gets created and can be built in
either order once Phase 2 exists. Phase 4 is shared by both and is the
highest-risk component — the constitution requires full unit coverage on it.

## Job execution & billing layer

Source plan: `plans/12-jobs-billing.md`. Four phases (J1–J4) adding what the
campaign schema has no representation of — execution attempts, retry state,
concurrency, dependencies — plus plan limits and Shopify billing.

- **J1. Job & Billing Schema** — **Complete** →
  `tasks/mvp-phase-j1-job-billing-schema.md`
- **J2. Job Engine & Dispatcher** — **Complete** →
  `tasks/mvp-phase-j2-job-engine-dispatcher.md`
- **J3. Plan Limits, Usage & Overlap Resolution** — **Complete** →
  `tasks/mvp-phase-j3-plan-limits-usage-overlap.md`
- **J4. Shopify Billing Integration** — **Complete** (unverified against a real
  store) → `tasks/mvp-phase-j4-shopify-billing.md`

All four complete. **Every phase in the plan is now built.** What remains
before launch is not more phases — it is a development store, webhook
registration at install, and confirming the pinned API version. See
`plans/14-launch-readiness.md`.

## Shared type package (`packages/shared`)

Built 2026-08-14, alongside Phase 1 rather than as a phase of its own.
`@pricelogic/shared` holds the domain models, enums, API DTOs and the exact
decimal money/pricing math, consumed by both apps through a local `file:`
dependency. Backend entities `implements` its models, so a column that exists
on one side and not the other fails the build.

Two things it changes for every later phase:

- **Phase 4 no longer writes the price calculator from scratch.**
  `calculatePrice`, `resolveBasePrice` and `applyPriceEnding` already exist
  with 57 tests. That phase's job shrinks to resolving the target set and
  wiring the calculator to Shopify data.
- **New domain shape goes into the shared model first**, then the entity, then
  the migration. See `backend/src/common/entities/README.md`.

Resolved in J1: `campaigns.round_strategy` now exists (UP / DOWN / NEAREST),
and `round_to` is null when the merchant turns rounding off. The default is
still UP, so a 20% discount landing on `11.00` becomes `11.99` — worth
revisiting with a merchant in front of it, but it is now a setting rather than
a limitation.

## Deferred — after MVP

- **Volume discounts** and **countdown timers**. Two of the four pricing tiers
  are differentiated by them (1/10/30/unlimited and 1/5/100/unlimited), so the
  pricing page cannot advertise those tiers honestly until they exist.
  Confirmed 2026-08-14 as post-MVP: build the bulk price editor first, add
  these after.

  Neither has any schema. Volume discounts are quantity breaks, which on
  Shopify means a Discount Function — a different mechanism from writing
  variant prices, not an extension of it. Countdown timers need a theme app
  extension plus per-campaign timer config. Each is its own phase.

  `app_plans.active_campaign_limit` already exists and is the natural place to
  cap them once campaign types are introduced.

## Still valid from the previous plan

- **Shopify App Shell & Tenant Foundation** → `tasks/phase-01-shopify-app-shell-tenant-foundation.md` — **Complete.** OAuth, session storage, encrypted tokens, the `shops` table and the tenant-scoping pattern all carry over unchanged.

## Superseded

These describe the 17-table schema and the supplier-cost/pricing-rule product
that the 2026-08-12 redesign replaced. Kept as history — do not implement.

- `tasks/phase-02-database-schema-domain-model.md` *(was Complete; its tables are dropped in MVP Phase 1)*
- `tasks/phase-03-product-variant-synchronization.md` → replaced by MVP Phase 2 (no catalog mirror)
- `tasks/phase-04-pricing-engine-core.md` → narrowed into MVP Phase 4
- `tasks/phase-05-pricing-rule-management.md` → folded into MVP Phase 3
- `tasks/phase-06-bulk-pricing-operation-workflow.md` → replaced by MVP Phase 6
- `tasks/phase-07-price-history-rollback.md` → replaced by MVP Phase 7
- `tasks/phase-08-supplier-csv-import.md` → replaced by MVP Phase 5
- `tasks/phase-09-supplier-driven-repricing.md` → dropped (no supplier cost or margin in MVP)
- `tasks/phase-10-scheduling-infrastructure.md` → folded into MVP Phase 7
- `tasks/phase-11-pricing-campaigns.md` → campaigns are now the whole product; see MVP Phases 3, 6, 7
- `tasks/phase-12-dashboard-notifications-ux.md` → folded into MVP Phase 8
- `tasks/phase-13-security-hardening.md` → folded into MVP Phase 8
- `tasks/phase-14-reliability-testing-launch-readiness.md` → folded into MVP Phase 8

## Documentation debt

- `plans/07-database.md` — **resolved 2026-08-14.** Marked superseded; the
  schema as built is now documented in `plans/13-database-map.md`, read from a
  live database rather than from intent.
- `plans/03-domain-model.md` still models suppliers, costs, margins and pricing
  operations. Needs revising or marking superseded — the project's own rule
  (`00-readme.md` §9) is that documentation is updated before implementation.
