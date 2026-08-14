# Phase 8: Dashboard, Hardening & Launch Readiness

Status: Not Started
Source: plans/11-campaign-supplier-mvp.md — Phase 8

## Tasks

- [ ] **Build the campaign list screen** — Polaris index table of campaigns with status badge, price source, schedule window, and affected-variant count. Filter by status, sort by start date. This is the app's home screen.

- [ ] **Build the campaign results screen** — Per-campaign view of its `price_changes` rows: product, variant, old price, new price, status. Failures shown first with their error messages, since that is why a merchant opens this screen. Paginated, and readable without a Shopify call because titles are cached on the row.

- [ ] **Show live progress during activation and revert** — Poll the counters from Phase 6 and render a real progress bar with applied, failed and skipped counts. A long-running bulk operation that shows only a spinner reads as broken.

- [ ] **Handle the app-uninstalled webhook** — Move the shop to `DISCONNECTED` and stop the scheduler from touching its campaigns. An active campaign on an uninstalled shop must not keep trying to write. Verify the webhook HMAC before acting on it.

- [ ] **Handle Shopify's mandatory GDPR webhooks** — `customers/data_request`, `customers/redact` and `shop/redact` are required for App Store review. This app stores no customer data, so the first two are acknowledged no-ops; `shop/redact` must delete the shop's rows. Document that reasoning in the handler.

- [ ] **Audit every query for tenant scoping** — Walk every repository call and confirm it is shop-scoped. The composite foreign keys from Phase 1 make cross-tenant *writes* impossible, but they do not stop a missing `WHERE shop_id` on a *read*. Add integration tests that authenticate as shop A and attempt to read every resource type belonging to shop B.

- [ ] **Decide the `audit_logs` question** — Phase 1 dropped it. Review `10-security.md` and App Store requirements and either reinstate it as a single additive migration, or record the decision not to. Do not leave this open at launch.

- [ ] **Add rate-limit and failure resilience across long runs** — A campaign spanning tens of thousands of variants must survive throttling, a token refresh and a transient 5xx without losing its place. Verify the retry paths from Phases 2 and 6 hold under a sustained run, not just a single call.

- [ ] **Write end-to-end tests for the two money paths** — Sheet upload → approve → activate → revert, and campaign builder → preview → activate → revert. Assert exact decimal values at every step and that a failure mid-run leaves recoverable state. These are the tests that decide whether this app is safe to point at a real store.

- [ ] **Run a pre-submission App Store compliance check** — Verify billing (if charging), embedded app behaviour, session token auth, webhook coverage, and the required GDPR handlers before submitting for review.
