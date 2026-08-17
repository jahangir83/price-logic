# Phase 6: Activation — Applying Changes to Shopify

Status: Complete (unverified against a real store)
Completed: 2026-08-14
Source: plans/11-campaign-supplier-mvp.md — Phase 6

> The Shopify write cannot join a database transaction. Everything in this
> phase is designed around that: partial failure is the normal case, not the
> exception.

## Tasks

- [x] **Build the activation service and its entry points** — One service invoked by the scheduler (Phase 7) and by a manual "activate now" action. Moves the campaign through `SCHEDULED → ACTIVE`, using the Phase 3 state machine rather than writing `status` directly. Refuses to run on a campaign that is already active or terminal.

- [x] **Re-read current prices immediately before writing** — Resolve targets, then fetch live prices from Shopify — never from cache and never from the preview. The gap between preview and activation can be days for a scheduled campaign, and `old_price` must be what the price actually was at the moment we changed it, or revert restores the wrong number.

- [x] **Write `price_changes` rows in `PENDING` before touching Shopify** — Recompute every price server-side from campaign config (or `approved_price` for a sheet campaign), then insert the rows with `old_price`, `old_compare_at_price`, `new_price`, `new_compare_at_price` and cached titles. Rows exist before the external call, so a crash mid-write leaves a recoverable record rather than an untracked mutation.

- [x] **Skip rows that would not change anything** — If `new_price` equals `old_price` and compare-at is unchanged, mark the row `SKIPPED` and do not call Shopify. On a large catalog this removes most of the work and most of the rate-limit pressure.

- [x] **Apply price changes to Shopify in batches** — Use `productVariantsBulkUpdate` so one call covers many variants of a product, respecting the Phase 2 cost-aware throttle. On success mark rows `APPLIED` with `applied_at`; on per-variant failure mark that row `FAILED` with the Shopify error message and continue with the rest.

- [x] **Apply tag changes and record them** — For each in-scope product, compute the resulting tag set from `add_tags` and `remove_tags`, and write a `product_tag_changes` row with the complete before and after set **only when the set actually changes**. If a product already carries a tag the campaign wanted to add, write nothing, so deactivation later leaves the merchant's own tag alone. This is the constitution's rule: reverse from a record of what was done, never from config.

- [x] **Make activation idempotent and safely retryable** — `UNIQUE (campaign_id, shopify_variant_id)` is the guard: a retry that tries to re-insert an existing pair must be caught and treated as "already handled", not as an error. A retried activation must resume from `PENDING` and `FAILED` rows only, never re-apply an `APPLIED` one.

- [x] **Maintain live progress counters** — Report applied, failed and skipped counts as the run proceeds so the UI can show a progress bar, not a spinner. Decide where the counters live — recommend deriving them from `price_changes` with an indexed count query rather than denormalising onto the campaign, since the campaign row would then need locking.

- [x] **Decide the campaign outcome honestly** — A run where every row applied is `ACTIVE`. A run where none applied is `FAILED`. A run with a mix stays `ACTIVE` but must surface the failure count prominently — the constitution's principle that a failed update must never appear successful. Write the rule down; do not leave it to the UI.

- [x] **Write integration tests for partial failure** — Simulate Shopify rejecting a subset of variants mid-batch and assert: the good rows are `APPLIED`, the bad rows are `FAILED` with messages, the campaign reports the mix, and a retry re-attempts only the failures and applies nothing twice.

## Correction to this phase's brief

Task 7 names `UNIQUE (campaign_id, shopify_variant_id)` as the idempotency
guard. **That index no longer exists.** J1 moved it to
`(job_id, shopify_variant_id)` to fix a real bug: keyed on the campaign, a
second activation could not insert a row and had to overwrite the first run's
`old_price`, destroying the price revert would need to restore.

The guarantee is therefore per **execution**:

- a retry of the *same* job cannot double-apply a variant — the unique index
  rejects the re-insert, and `orIgnore` treats that as "already handled"
- a genuine re-activation is a *new* job, writes fresh rows, and keeps both
  runs' history

## Decisions taken

**A retry never re-plans.** If Shopify's price moved between attempts,
re-reading would store a different `old_price` than the rows already applied,
and revert would restore a number that was never on the storefront. A run with
existing rows resumes from them.

**The campaign outcome rule**, written here rather than left to the UI:

| Result | Status |
| --- | --- |
| Anything applied | **ACTIVE** — prices are live and must be revertible |
| Attempted, nothing applied | **FAILED** |
| Nothing to do at all | **ACTIVE** — running correctly over an empty set |

A mixed run stays ACTIVE **and** carries a non-zero failure count, which is
what stops it appearing successful. The count travels in the outcome rather
than being left for the UI to derive. The *job* additionally fails when nothing
applied, so an all-failed run is visible in the queue and not just on a
campaign page.

**Progress is derived, not denormalised.** One indexed count over
`price_changes` per batch, rather than running totals on the campaign row —
which would need locking on every batch.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (106 files) | 0 errors, 0 warnings |
| backend: unit tests | 216 passed, 14 suites |
| backend: integration tests | 139 passed, 7 suites (21 new) |
| frontend: `tsc -b` / `vite build` | pass |

Proven against a Shopify that fails on purpose:

- a clean run applies everything and records `old_price` as what the price
  actually was
- variants of one product go in **one** call, not one per variant
- a row that changes nothing is written SKIPPED and **never sent** — most of
  the work and most of the rate-limit pressure on a large catalog
- a rejected variant is FAILED with Shopify's own message while its siblings
  apply
- a mixed run stays ACTIVE with a non-zero failure count
- an all-rejected run is FAILED; an empty run is ACTIVE
- a retry sends **only** the previously failed variant, applies nothing twice,
  duplicates no rows, and keeps the original `old_price` even when the live
  price has since moved
- tags record the complete before/after set, and write **nothing** when the
  product already carried the tag
- a product whose price failed is not tagged
- a plan-limit breach writes nothing and sends nothing — the gate is before
  the first mutation

## ⚠ Not verified against Shopify

`productVariantsBulkUpdate` and `productUpdate` are written from the API docs
and exercised against a stub. The mutation shapes, the `userErrors` field
paths that attribute a message to a variant, and the pinned `2025-01` API
version all need one pass against a development store **before this runs on a
real storefront**. This is the phase where that debt stops being a note and
becomes wrong prices customers can see.
