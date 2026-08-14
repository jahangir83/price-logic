# Phase 6: Activation — Applying Changes to Shopify

Status: Not Started
Source: plans/11-campaign-supplier-mvp.md — Phase 6

> The Shopify write cannot join a database transaction. Everything in this
> phase is designed around that: partial failure is the normal case, not the
> exception.

## Tasks

- [ ] **Build the activation service and its entry points** — One service invoked by the scheduler (Phase 7) and by a manual "activate now" action. Moves the campaign through `SCHEDULED → ACTIVE`, using the Phase 3 state machine rather than writing `status` directly. Refuses to run on a campaign that is already active or terminal.

- [ ] **Re-read current prices immediately before writing** — Resolve targets, then fetch live prices from Shopify — never from cache and never from the preview. The gap between preview and activation can be days for a scheduled campaign, and `old_price` must be what the price actually was at the moment we changed it, or revert restores the wrong number.

- [ ] **Write `price_changes` rows in `PENDING` before touching Shopify** — Recompute every price server-side from campaign config (or `approved_price` for a sheet campaign), then insert the rows with `old_price`, `old_compare_at_price`, `new_price`, `new_compare_at_price` and cached titles. Rows exist before the external call, so a crash mid-write leaves a recoverable record rather than an untracked mutation.

- [ ] **Skip rows that would not change anything** — If `new_price` equals `old_price` and compare-at is unchanged, mark the row `SKIPPED` and do not call Shopify. On a large catalog this removes most of the work and most of the rate-limit pressure.

- [ ] **Apply price changes to Shopify in batches** — Use `productVariantsBulkUpdate` so one call covers many variants of a product, respecting the Phase 2 cost-aware throttle. On success mark rows `APPLIED` with `applied_at`; on per-variant failure mark that row `FAILED` with the Shopify error message and continue with the rest.

- [ ] **Apply tag changes and record them** — For each in-scope product, compute the resulting tag set from `add_tags` and `remove_tags`, and write a `product_tag_changes` row with the complete before and after set **only when the set actually changes**. If a product already carries a tag the campaign wanted to add, write nothing, so deactivation later leaves the merchant's own tag alone. This is the constitution's rule: reverse from a record of what was done, never from config.

- [ ] **Make activation idempotent and safely retryable** — `UNIQUE (campaign_id, shopify_variant_id)` is the guard: a retry that tries to re-insert an existing pair must be caught and treated as "already handled", not as an error. A retried activation must resume from `PENDING` and `FAILED` rows only, never re-apply an `APPLIED` one.

- [ ] **Maintain live progress counters** — Report applied, failed and skipped counts as the run proceeds so the UI can show a progress bar, not a spinner. Decide where the counters live — recommend deriving them from `price_changes` with an indexed count query rather than denormalising onto the campaign, since the campaign row would then need locking.

- [ ] **Decide the campaign outcome honestly** — A run where every row applied is `ACTIVE`. A run where none applied is `FAILED`. A run with a mix stays `ACTIVE` but must surface the failure count prominently — the constitution's principle that a failed update must never appear successful. Write the rule down; do not leave it to the UI.

- [ ] **Write integration tests for partial failure** — Simulate Shopify rejecting a subset of variants mid-batch and assert: the good rows are `APPLIED`, the bad rows are `FAILED` with messages, the campaign reports the mix, and a retry re-attempts only the failures and applies nothing twice.
