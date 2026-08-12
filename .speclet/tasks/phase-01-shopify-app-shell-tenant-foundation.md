# Phase 1: Shopify App Shell & Tenant Foundation

Status: Complete
Completed: 2026-08-08
Source: plans/06-product-requirements.md #6-7; plans/07-database.md #7-9; plans/10-security.md #4,6-9; plans/04-user-flows.md #4-5

## Tasks

- [x] **Scaffold the application shell** — Create the base app project (server entry point, config loading, routing/module structure) that the OAuth flow, store initialization, and all later features will be built into. Done when the app boots, serves a health/status endpoint, and reads configuration from environment.

- [x] **Set up environment/secret management** — Establish a mechanism for supplying `DATABASE_URL`, `SHOPIFY_CLIENT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, and future secrets via environment/secret manager, never hard-coded. Add an example env template (no real values) and ensure real `.env` files are excluded from version control. Done when the app fails fast/clearly if a required secret is missing.

- [x] **Implement Shopify OAuth install flow** — Build the install/authorize redirect and callback that identifies the requesting Shopify store, completes the required authorization handshake, and verifies the store context before proceeding (per user-flows #4: Shopify → PriceLogic → Store Authentication). Done when a merchant can install the app from Shopify and land back in PriceLogic authenticated for their store.

- [x] **Handle authentication/installation failures clearly** — Detect and surface failed or incomplete OAuth handshakes, invalid shop domains, and denied authorization with a clear, non-technical message to the merchant (PR #6 acceptance criteria). Done when a failed install cannot leave the merchant on a broken/blank state or a half-created Shop record.

- [x] **Create the Shop record on successful install** — On successful OAuth, create a `shops` record with: `shopify_shop_id`, `shop_domain`, `access_token`/secure credential reference, `currency`, `timezone`, `status`, `created_at`, `updated_at` (db #8). Done when every successful install results in exactly one persisted Shop record scoped as the tenant root for all future data.

- [x] **Enforce shop uniqueness and safe reinstall/reconnect** — Add `UNIQUE(shopify_shop_id)` and `UNIQUE(shop_domain)` constraints so a Shopify store maps to exactly one PriceLogic Shop, and implement reinstall/reconnect logic that updates the existing Shop record (e.g. refreshed token, status) instead of creating a duplicate tenant (PR #6, db #9). Done when reinstalling the app on an already-connected store never produces a second Shop row.

- [x] **Implement Shop status lifecycle** — Support `ACTIVE`, `DISCONNECTED`, `SUSPENDED` status values on the Shop record, transitioning appropriately on install, uninstall/disconnect, and any suspension trigger. Done when app behavior (e.g. blocking pricing actions) correctly reflects a non-`ACTIVE` shop.

- [x] **Protect Shopify credentials at rest and in transit** — Encrypt the stored access token/credential reference at rest, and ensure it is never sent to the frontend, never logged, and never included in error messages (security #8). Done when a code/log audit shows no path that exposes the raw token outside the server-side data layer.

- [x] **Enforce tenant isolation on every query** — Establish the pattern/helper (e.g. required `shop_id` filter) that all tenant-owned data access must follow, so no query can return another shop's rows even by accident (security #4-5: e.g. `WHERE id = ? AND shop_id = ?`, never `WHERE id = ?` alone). Done when this pattern is documented and enforced for the Shop-scoped tables introduced from this phase onward.

- [x] **Implement the authorization chain for protected endpoints** — Build middleware/guard that checks, in order: Authenticated? → Authorized? → Correct Shop? → Allowed Action? for every protected API operation, never trusting a client-supplied `shop_id` without verifying ownership from the authenticated session (security #6). Done when an authenticated user from Shop A cannot pass a Shop B identifier and act on Shop B's context.

- [x] **Implement session authentication and lifecycle** — Use the platform's supported authentication mechanism to validate sessions, expire/revoke invalid ones, and protect all authenticated endpoints; never expose server-side Shopify credentials to the browser (security #7). Done when unauthenticated or expired-session requests to protected endpoints are rejected.

- [x] **Implement store initialization flow** — After authentication, run store configuration setup, apply default pricing settings, and kick off initial product/variant sync, exposing initialization progress to the merchant (PR #7, user-flows #5). Done when a newly connected shop ends initialization with default settings persisted and sync underway/visible.

- [x] **Build the initial setup wizard steps** — Implement the setup sequence: Store connected → Product synchronization → Default pricing strategy → Minimum margin/price protection → Finish setup, with all values editable later (user-flows #5). Done when a merchant can complete or skip through each step and revisit/change the settings afterward from elsewhere in the app.
