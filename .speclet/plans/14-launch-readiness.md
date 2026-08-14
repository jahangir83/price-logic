# Launch Readiness

> Written 2026-08-15 as part of MVP Phase 8. Two things live here: the
> `audit_logs` decision that has been open since Phase 1, and the App Store
> compliance audit.

---

## Decision: `audit_logs` is not reinstated

Phase 1 dropped `audit_logs` and left the question open. **The answer is no**,
for MVP, and the reasoning matters more than the verdict because it is only
valid while the premises hold.

### What the table was for

`10-security.md` asked for an append-only record of who did what: actor,
action, entity, before/after. The re-baseline dropped it along with the rest of
the 17-table schema and nothing has needed it since.

### Why it is not needed now

**The mutating actions already keep their own records, and better ones.**
Everything this app changes on a merchant's store is recorded on the row that
did it:

| What changed | Where the record is | What it holds |
| --- | --- | --- |
| A variant's price | `price_changes` | old and new price, old and new compare-at, who ran it (`job_id`), when it applied, when it reverted, the Shopify error if it failed |
| A product's tags | `product_tag_changes` | the complete tag set before and after |
| Every execution | `job_executions` | each attempt, its step, its result, whether it was superseded |
| Billing | `store_subscription_events` | append-only, from/to plan |

A generic audit table would record *less* about these than the tables already
do, and it would duplicate what it did record — which is how the two drift and
the audit log becomes the one you cannot trust.

**There is no second actor to disambiguate.** Sessions are per shop, not per
staff member; the app has no user accounts and no roles. "Who did this?" has
exactly one answer — the merchant — so an `actor_id` column would be a
constant.

**Shopify does not require it.** App Store review requires the GDPR webhooks,
HMAC verification and session-token auth. None of them ask for an audit trail,
and this app stores no customer data to audit access to.

### What would change the answer

Reinstate it the moment any of these becomes true:

- **Staff accounts or roles.** Two people who can both start a campaign make
  "who did this?" a real question.
- **Anything destructive without its own record.** Deleting a supplier, editing
  a campaign mid-run, changing a plan limit by hand — none of these currently
  leave a trail, and none currently matter. That changes if support starts
  making them.
- **A merchant dispute the current tables cannot settle.** They can answer
  "what did you change and when"; they cannot answer "who configured it this
  way and when did they change it".

It is a single additive migration, which is exactly why deferring it is cheap
and why this is a decision rather than an omission.

**Related but separate:** `campaigns` has no revision history. The reference
app keeps `SalesCampaignRevision` for "you edited this discount". That is a
product feature, not an audit requirement, and it is not in MVP scope either.

---

## App Store compliance audit

Checked against the code on 2026-08-15. **Nothing here has been verified
against a real store**, because `.env` still holds placeholder credentials.
Items marked ⚠ are code-complete but unproven.

### Authentication and session

| Requirement | Status |
| --- | --- |
| OAuth install flow | ✅ `shopify-auth` module |
| Access token encrypted at rest | ✅ AES-256-GCM, never stored raw |
| Session token auth on embedded requests | ⚠ JWT sessions exist; App Bridge token exchange needs verifying against a real embedded load |
| Shop resolved from the session, never from a request parameter | ✅ `ShopGuard`; proven by 23 tenant-isolation tests |

### Webhooks

| Topic | Status |
| --- | --- |
| `app/uninstalled` | ✅ moves the shop to DISCONNECTED; the scheduler then skips it |
| `customers/data_request` | ✅ acknowledged no-op — this app stores no customer data |
| `customers/redact` | ✅ acknowledged no-op, same reason |
| `shop/redact` | ✅ deletes every row the shop owns, in one transaction |
| HMAC verified before acting | ✅ timing-safe compare against the raw body |
| Redelivery handled | ✅ `webhook_deliveries` unique on Shopify's delivery id |
| Registered with Shopify at install | ⚠ **not implemented** — the handlers exist but nothing subscribes to the topics. Needs a dev store. |

### Billing

| Requirement | Status |
| --- | --- |
| Plans and limits | ✅ seeded, enforced shop-wide before any mutation |
| `appSubscriptionCreate` | ❌ **J4, not built** |
| `APP_SUBSCRIPTIONS_UPDATE` webhook | ❌ J4 |
| Charges confirmed before entitlement | ❌ J4 — every shop currently resolves to Free |

**The app cannot charge anyone yet.** That is the single largest gap remaining.

### Data handling

| Requirement | Status |
| --- | --- |
| No customer data stored | ✅ verified by inspection — no orders, carts or identifiers anywhere in the schema |
| Catalog not mirrored | ✅ by design; Shopify stays the source of truth |
| Merchant data deletable | ✅ `shop/redact` |
| Tenant isolation | ✅ composite foreign keys make cross-tenant writes unrepresentable; 23 read tests |

### API behaviour

| Requirement | Status |
| --- | --- |
| Rate limiting respected | ✅ cost-aware, throttles ahead of the limit |
| Retries with backoff | ✅ jittered, capped, non-retryable errors excluded |
| API version pinned | ⚠ `2025-01` — **check it is still supported before submitting** |
| Bulk mutations batched | ✅ one call per product |

---

## What actually blocks submission

In order:

1. **J4 — Shopify billing.** No charge can be created. Everything else is
   polish by comparison.
2. **A development store.** Six phases of Shopify code have never run against
   Shopify. Webhook registration, the embedded session-token flow, and every
   GraphQL query and mutation are all unverified.
3. **`SHOPIFY_API_VERSION`.** Confirm `2025-01` is still supported.
4. **Webhook subscription at install.** The handlers are ready; nothing
   registers them.

Everything above the line is done and tested. Nothing above the line can be
*trusted* until item 2 is resolved.
