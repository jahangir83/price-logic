# Phase 8: Dashboard, Hardening & Launch Readiness

Status: Complete (one task cannot be finished without a dev store)
Completed: 2026-08-15
Source: plans/11-campaign-supplier-mvp.md — Phase 8

## Tasks

- [x] **Build the campaign list screen** — Polaris index table of campaigns with status badge, price source, schedule window, and affected-variant count. Filter by status, sort by start date. This is the app's home screen.

- [x] **Build the campaign results screen** — Per-campaign view of its `price_changes` rows: product, variant, old price, new price, status. Failures shown first with their error messages, since that is why a merchant opens this screen. Paginated, and readable without a Shopify call because titles are cached on the row.

- [x] **Show live progress during activation and revert** — Poll the counters from Phase 6 and render a real progress bar with applied, failed and skipped counts. A long-running bulk operation that shows only a spinner reads as broken.

- [x] **Handle the app-uninstalled webhook** — Move the shop to `DISCONNECTED` and stop the scheduler from touching its campaigns. An active campaign on an uninstalled shop must not keep trying to write. Verify the webhook HMAC before acting on it.

- [x] **Handle Shopify's mandatory GDPR webhooks** — `customers/data_request`, `customers/redact` and `shop/redact` are required for App Store review. This app stores no customer data, so the first two are acknowledged no-ops; `shop/redact` must delete the shop's rows. Document that reasoning in the handler.

- [x] **Audit every query for tenant scoping** — Walk every repository call and confirm it is shop-scoped. The composite foreign keys from Phase 1 make cross-tenant *writes* impossible, but they do not stop a missing `WHERE shop_id` on a *read*. Add integration tests that authenticate as shop A and attempt to read every resource type belonging to shop B.

- [x] **Decide the `audit_logs` question** — Phase 1 dropped it. Review `10-security.md` and App Store requirements and either reinstate it as a single additive migration, or record the decision not to. Do not leave this open at launch.

- [x] **Add rate-limit and failure resilience across long runs** — A campaign spanning tens of thousands of variants must survive throttling, a token refresh and a transient 5xx without losing its place. Verify the retry paths from Phases 2 and 6 hold under a sustained run, not just a single call.

- [x] **Write end-to-end tests for the two money paths** — Sheet upload → approve → activate → revert, and campaign builder → preview → activate → revert. Assert exact decimal values at every step and that a failure mid-run leaves recoverable state. These are the tests that decide whether this app is safe to point at a real store.

- [~] **Run a pre-submission App Store compliance check** — Verify billing (if charging), embedded app behaviour, session token auth, webhook coverage, and the required GDPR handlers before submitting for review.

## ⚠ The last task is a code audit, not a real check

`plans/14-launch-readiness.md` records what the code does against each App
Store requirement. It is **not** a pre-submission check, because that needs a
Partner account and a development store, and `.env` still holds placeholders.
The task is marked `[~]`, not `[x]`.

Three things the audit found that are code-complete but unproven, and one that
is genuinely missing:

- ⚠ session-token auth on an embedded load
- ⚠ every GraphQL query and mutation
- ⚠ `SHOPIFY_API_VERSION=2025-01` — confirm it is still supported
- ❌ **nothing registers the webhook topics at install.** The handlers exist
  and are tested; the subscription does not.

## Decision: `audit_logs` stays dropped

Recorded in full in `plans/14-launch-readiness.md`. The short version: every
mutating action already keeps a better record than a generic audit table would
— `price_changes` holds old and new prices with the job that wrote them,
`product_tag_changes` holds complete before/after sets, `job_executions` holds
every attempt — and with no staff accounts there is no second actor to
disambiguate. Reinstate it the moment roles appear or a destructive action
lands without its own record. One additive migration, which is why deferring
is cheap.

## New migration

`1786950000000-WebhookDeliveries.ts`. Shopify redelivers aggressively; without
this a redelivered `app/uninstalled` can disconnect a shop that has since
reinstalled, and a redelivered `shop/redact` re-runs a deletion. The unique
index on Shopify's own delivery id is the whole mechanism.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (115 files) | 0 errors, 0 warnings |
| backend: unit tests | 216 passed, 14 suites |
| backend: integration tests | **190 passed**, 10 suites (32 new) |
| frontend: eslint (31 files) / `tsc -b` / `vite build` | 0 errors · pass · pass |
| shared: unit tests | 126 passed |

**Tenant isolation, 23 tests.** Shop A attempts to read, edit, delete and
cancel every resource type belonging to shop B — campaigns, targets,
suppliers, imports, csv rows, jobs, billing usage — and fails at every one.
Three more confirm the write side is still unrepresentable rather than merely
guarded.

**The money paths, 9 tests.** Both flows end to end with exact decimals:

- builder → preview → activate → revert, asserting the previewed number is the
  number the storefront got, and that a product already on sale keeps its
  original compare-at through the round trip
- sheet → approve → activate → revert, including a merchant's edited price
  winning over the supplier's
- a variant refused twice then accepted — the shape of a clearing rate limit —
  resuming and finishing without applying anything twice
- a partial run still fully revertible
- 300 variants batched by product

## Notes

- `CampaignsService` now takes the **shared request contract** rather than the
  DTO class. The DTO carries marker fields the validator reads, and requiring
  them of every caller made an ordinary `{ title: 'x' }` fail to compile —
  which the tenant audit found.
- The scheduler now skips shops that are not ACTIVE, so an uninstalled
  merchant's campaigns stop trying to write.
