# Install and boot flow

Status: Complete (unverified against a real store)
Completed: 2026-08-15

Closes the last gap between "the backend is built" and "a merchant can open the
app": webhook registration at install, an install gate the frontend asks before
it renders, and a shop-bound Shopify client so callers stop threading a `Shop`
through every layer.

## What was built

- [x] **Webhook registration at install** — `WebhookRegistrarService` subscribes
  the shop to all five topics using GraphQL `webhookSubscriptionCreate`, called
  from `completeInstall` with the token that was just exchanged.

- [x] **An install gate** — `GET /store/check-installation?shop=&host=`,
  unauthenticated, answering `{ installed, authUrl }`.

- [x] **A frontend boot sequence** — `src/bootstrap/`: read params → check
  install → either top-frame redirect to OAuth, or load App Bridge and mount
  React. Nothing renders until that decision is made.

- [x] **`host` carried across the OAuth round trip** — a short-lived cookie set
  at `/auth`, read at `/auth/callback`, put back on the return URL.

- [x] **`ShopifyClient` + `ShopifyClientFactory`** — one shop bound once, with a
  typed method per operation and a `gql<T>()` escape hatch that still goes
  through the throttle.

## Decisions taken

**Webhooks register at install, not lazily.** It is the only moment we are
certain to hold a working token, and a reinstall carries no subscriptions over.

**A failed registration never aborts the install.** A merchant with a working
app and one missing webhook is far better off than one who cannot install at
all; the result is returned so a caller can log it and retry.

**"Already been taken" is success.** It is what Shopify says on a reinstall, and
it describes exactly the state we wanted.

**The install gate is deliberately unauthenticated.** It is asked before a
session exists, by an app the merchant may never have installed. It leaks
nothing: the input is a domain the caller already typed, the output a boolean
about a public app.

**A shop that uninstalled answers `installed: false`.** Its row survives as
DISCONNECTED so its campaign history is there when it returns, but its token is
dead — so it needs OAuth, not a render that 401s on every request.

**The backend owns the OAuth URL.** Scopes, state and redirect URI live in one
place; the frontend only follows `authUrl`.

**`host` round-trips through a cookie.** Shopify returns `shop` on the callback
but not `host`, and the frontend cannot hold it either — the redirect happens in
the top frame, and sessionStorage written inside Shopify's iframe is partitioned
away from the top-level context in every current browser.

**App Bridge loads before React mounts.** It is read from the global when a
component mounts, so a late load means the first render sees a window without
it — and it refuses to initialise from an `async`/`defer` script tag, so both
are turned off and the attributes removed.

**The install result is cached for 30 minutes, positive only.** A cached "no"
would be a promise we cannot keep for a merchant who just installed.

**`/auth/error` bypasses the gate.** The backend redirects there precisely when
it could not establish a shop; gating it would replace the reason for the
failure with a generic "open from your admin".

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (123 files) | 0 errors, 0 warnings |
| backend: unit tests | **229 passed**, 15 suites (13 new) |
| backend: e2e tests | **219 passed**, 12 suites (7 new) |
| shared: tests | 126 passed, 5 suites |
| frontend: `tsc -b` / eslint / `vite build` | pass · 0 errors · pass |

Proven: all five topics subscribed in order, the three mandatory privacy topics
present, enum topic names never the REST slash form, a trailing slash on the app
URL stripped so a callback is not registered twice, a bare host given a scheme,
"already taken" counted as present, a real userError counted as failed, one
failing topic not costing the other four, registration never rejecting, and the
freshly exchanged token used rather than one read back from the shop row.

For the gate: installed / never-installed / uninstalled all answered correctly,
`host` carried into the auth URL, no session cookie required, and a non-myshopify
domain refused without an `authUrl` to follow.

One thing the run found: the e2e suites that open a raw `DataSource` had no way
to see `DATABASE_URL` unless the shell exported it by hand, and failed with a
bare `SASL: client password must be a string`. `test/setup-env.ts` now loads
`.env` for the runner, with `override: false` so an explicit export still wins.

## ⚠ Not verified against Shopify

`webhookSubscriptionCreate` and the exact wording of the "already been taken"
userError are written from the API docs and exercised against a stub. **No
webhook has ever been registered, and no merchant has ever completed OAuth.**
The App Bridge boot path has not run inside a real Shopify admin iframe.
