# Phase 2: Live Shopify Catalog Access

Status: Complete (unverified against a real store — see below)
Completed: 2026-08-14
Source: plans/11-campaign-supplier-mvp.md — Phase 2

> Replaces `phase-03-product-variant-synchronization.md` entirely. Nothing is
> synchronised or stored — the catalog is read from Shopify on demand.

## Tasks

- [x] **Build the Shopify Admin GraphQL adapter service** — One `ShopifyAdminService` in a dedicated adapter module that owns the GraphQL client, per-shop token decryption, API version pinning and error translation. Per the constitution, no controller and no React component may call Shopify directly — everything routes through here. Done when a controller can request catalog data without knowing Shopify exists.

- [x] **Implement cost-aware rate limiting and retry** — Shopify's Admin GraphQL uses a leaky-bucket cost model, not a request count. Read `extensions.cost.throttleStatus` from every response, throttle ahead of the limit rather than reacting to 429s, and retry with backoff on `THROTTLED`. Bulk operations later in Phase 6 depend on this being correct. Cover the backoff logic with unit tests against recorded responses.

- [x] **Implement product search** — Paginated search by title, returning id, title, handle, status, vendor, product type, tags and variant count. Backs the "Include by Products" picker. Must support cursor pagination and a query string, and must not fetch variants it does not need.

- [x] **Implement collection listing and search** — Paginated list of custom and smart collections with id, title and handle. Backs the "Include by Collections" picker.

- [x] **Implement tag, vendor and product-type listing** — Distinct values for each, for the "Include by Tags, Vendors, and Product Types" picker. These are shop-wide lookups; cache them harder than product search since they change rarely.

- [x] **Implement bulk variant price fetch** — Given a list of Shopify variant ids, return current `price`, `compareAtPrice`, `sku`, `title` and parent product title. This is what Phase 4 reads to compute `old_price` and what Phase 5 reads to fill `current_price`. Must batch ids rather than issuing one query per variant.

- [x] **Implement variant lookup by SKU** — Given a list of SKUs, resolve them to variant ids, product ids and current prices. Backs sheet matching in Phase 5. Must return duplicates rather than silently picking one, so the caller can flag ambiguous SKUs.

- [x] **Add a short-lived response cache** — In-memory or Redis, keyed by shop and query, with a TTL measured in seconds to minutes depending on volatility (tags/vendors long, prices very short). Prices used for an actual write must never come from cache — Phase 6 re-reads them. Done when the campaign builder stays responsive without any catalog table.

- [x] **Build the frontend picker components** — Polaris resource pickers for products, collections, and tags/vendors/product types, with search, pagination and multi-select, backed by the endpoints above. Shared components — Phase 3 wires them into include/exclude and Phase 5 reuses the product one for match review.

- [x] **Write integration tests against a mocked Shopify API** — Cover pagination, throttling and retry, empty results, and a revoked-token response. Assert the adapter surfaces a typed error rather than leaking a raw GraphQL payload to the controller.

## ⚠ Not verified against Shopify

Every test here runs against a **scripted transport**, not a store. `.env` still
holds placeholder credentials (`SHOPIFY_API_KEY=dev_…`), so no query in this
phase has ever been sent to Shopify.

That is enough to prove the adapter's own contract — pagination, throttle and
retry, typed errors, batching — and it is not enough to prove the *queries* are
right. Field names, the `variantsCount` shape and the `productVariants` search
syntax all need one pass against a development store before Phase 6 writes
anything.

**`SHOPIFY_API_VERSION` is pinned to `2025-01`.** Shopify retires versions on a
rolling schedule; check it is still supported at the same time.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (81 files) | 0 errors, 0 warnings |
| backend: unit tests | 84 passed, 9 suites (47 new) |
| backend: integration tests | 96 passed, 5 suites |
| frontend: eslint (21 files) | 0 errors, 0 warnings |
| frontend: `tsc -b` / `vite build` | pass |

Behaviour proven against the scripted API:

- a page maps to typed items and surfaces its cursor; an empty catalog does
  not invent a page
- product search asks for `variantsCount`, **not** variant nodes
- the page size is clamped to Shopify's 250 ceiling
- a search term containing a quote is escaped, not injected
- a repeated search is served from cache; a different query is not
- **variant prices skip the cache by default** — Phase 6 re-reads before it
  mutates
- 300 variant ids are two batched calls, not 300
- prices come back as exact decimal money, so a bad value fails at the edge
- a variant deleted between listing and pricing is skipped, not fatal
- an ambiguous SKU returns **every** match so the row can be flagged
- a SKU with no match is reported as an empty list, not omitted
- a fuzzy match Shopify volunteered is discarded
- a `THROTTLED` reply is retried and its bucket reading is still recorded
- a revoked token is a typed `UNAUTHORIZED` and is **not** retried
- a 5xx is retried, then reported as `UNAVAILABLE` after the budget
- an unknown GraphQL error never leaks its payload

## Notes for the next phase

- **Cost estimates are guesses.** `estimatedCost` is `first * 2` for product
  search and `batch.length` for variant nodes. Shopify reports the real cost on
  every response and the throttle corrects itself immediately, so the estimate
  only has to stop concurrent calls bursting. Worth re-checking against real
  numbers once a store is connected.
- **The throttle is per-process.** Two workers each keep their own view and can
  overshoot together; the retry on `THROTTLED` is what covers that. Sharing it
  needs Redis and should wait for the broker decision.
- `ShopifyAdminService.invalidate(shopId)` exists but nothing calls it — Phase 6
  should, immediately after applying prices.
- The pickers are shared components with no page wiring; Phase 3 mounts them
  into the campaign builder's include/exclude sides.
