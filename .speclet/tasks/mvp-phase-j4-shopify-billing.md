# Phase J4: Shopify Billing Integration

Status: Complete (unverified against a real store)
Completed: 2026-08-15
Source: plans/12-jobs-billing.md — Phase J4
Depends on: J1 (schema), J3 (plan limits) — both Complete

> Task list derived from the plan's Phase J4 section; there was no task file,
> so it was written here rather than blocking on `/speclet-tasks`.
>
> **This is the phase that most needs a real store.** Every task below talks to
> Shopify's Billing API, and none of it can be confirmed against placeholder
> credentials.

## Tasks

- [x] **Create a recurring charge** — `appSubscriptionCreate` with the plan's
  price, interval and trial days, returning Shopify's confirmation URL. Store
  the subscription row as PENDING with the returned GID before redirecting, so
  a merchant who abandons the flow leaves a record rather than a mystery.

- [x] **Handle the confirmation return** — Shopify redirects back after the
  merchant accepts or declines. Re-read the subscription from Shopify rather
  than trusting the redirect, and move the row to ACTIVE only on Shopify's own
  word.

- [x] **Handle `APP_SUBSCRIPTIONS_UPDATE`** — the authoritative signal for every
  later change: renewal, decline, cancellation, freeze. Map Shopify's status
  onto ours and record an event for each transition.

- [x] **Record every transition as an event** — append-only, with from/to plan,
  so a billing dispute can be answered months later.

- [x] **Handle trials** — a plan's `trialDays` become Shopify's trial, and the
  shop keeps full entitlements during it. An expired trial that was never
  confirmed drops to Free.

- [x] **Handle upgrade and downgrade** — creating a new subscription replaces
  the old one; Shopify cancels the previous charge automatically. A downgrade
  must not deactivate running campaigns — the limit gates new activations only.

- [x] **Handle the grace period** — a FROZEN subscription keeps its
  entitlements while Shopify retries the card, and loses them when it stops.

- [x] **Expose the plans and the current subscription** — an endpoint the
  pricing page reads, showing each plan, its limits, and which one the shop is
  on.

- [x] **Build the pricing page** — the four plans, the current one marked, and
  the shop's usage against its limit.

- [x] **Write tests against a mocked Billing API** — charge creation, an
  accepted and a declined return, each webhook status, and a downgrade that
  leaves a running campaign alone.

## The rule the whole phase follows

**We never decide a merchant is paying.** Every entitlement change traces back
to something Shopify said — the confirmation query or the update webhook — and
never to a redirect the merchant's browser made. The merchant lands on the
return URL whether they accepted or declined, so the status is re-read from
Shopify rather than taken from a query parameter.

## Decisions taken

**The subscription row is written PENDING before the redirect**, so a merchant
who abandons the flow leaves a record rather than a mystery, and the webhook
that arrives later has something to attach to.

**A frozen subscription keeps its entitlements.** Shopify freezes over a card
that will retry; dropping a merchant mid-campaign would deactivate live sales
over a temporary payment problem. Entitlements go when the status becomes
terminal, not when it becomes frozen.

**A downgrade never touches a running campaign.** The limit gates new
activations only. Deactivating a live sale because a merchant moved to Free
would cost them money without warning — there is a test asserting the campaign
stays ACTIVE.

**`DECLINED` maps to CANCELLED** rather than getting a status of its own: from
the app's point of view a declined charge and a cancelled one are the same
thing, which is no entitlement.

**`test: true` outside production**, so a development store can accept a charge
without anyone being billed.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (118 files) | 0 errors, 0 warnings |
| backend: unit tests | 216 passed, 14 suites |
| backend: integration tests | **212 passed**, 11 suites (22 new) |
| frontend: eslint (32 files) / `tsc -b` / `vite build` | 0 errors · pass · pass |

Proven against a scripted Billing API:

- the confirmation URL is returned, with the plan's price and trial days
- the annual price is used when asked
- the row is PENDING before the merchant sees Shopify's screen
- **a pending charge grants nothing** — limits stay on Free until confirmed
- an accepted charge grants the plan; a **declined** one does not
- a charge Shopify has forgotten is treated as cancelled, not left PENDING
- FROZEN keeps entitlements; CANCELLED after FROZEN removes them; ACTIVE after
  FROZEN restores them and records a renewal
- a payload with no status is ignored rather than corrupting the row
- every transition is recorded append-only
- a downgrade cancels the old charge, records a downgrade, applies the smaller
  limit — **and leaves a running campaign ACTIVE**

One real gap the tests found: an unknown plan handle reached Postgres and came
back as `invalid input value for enum` — a 500 telling the merchant nothing.
The service now validates the handle itself rather than relying on a DTO having
run, since the webhook and admin paths call it directly.

## ⚠ Not verified against Shopify

`appSubscriptionCreate`, the `AppSubscription` query and `appSubscriptionCancel`
are written from the API docs and exercised against a stub. So is the shape of
the `app_subscriptions/update` payload. **No charge has ever been created.**

Still outstanding for submission:

- a Partner account and a development store
- ~~webhook topic **registration** at install~~ — done: `WebhookRegistrarService`
  subscribes all five topics on every install and reinstall
- confirm `SHOPIFY_API_VERSION=2025-01` is still supported
