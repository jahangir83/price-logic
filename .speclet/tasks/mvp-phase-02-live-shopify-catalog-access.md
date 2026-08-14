# Phase 2: Live Shopify Catalog Access

Status: Not Started
Source: plans/11-campaign-supplier-mvp.md — Phase 2

> Replaces `phase-03-product-variant-synchronization.md` entirely. Nothing is
> synchronised or stored — the catalog is read from Shopify on demand.

## Tasks

- [ ] **Build the Shopify Admin GraphQL adapter service** — One `ShopifyAdminService` in a dedicated adapter module that owns the GraphQL client, per-shop token decryption, API version pinning and error translation. Per the constitution, no controller and no React component may call Shopify directly — everything routes through here. Done when a controller can request catalog data without knowing Shopify exists.

- [ ] **Implement cost-aware rate limiting and retry** — Shopify's Admin GraphQL uses a leaky-bucket cost model, not a request count. Read `extensions.cost.throttleStatus` from every response, throttle ahead of the limit rather than reacting to 429s, and retry with backoff on `THROTTLED`. Bulk operations later in Phase 6 depend on this being correct. Cover the backoff logic with unit tests against recorded responses.

- [ ] **Implement product search** — Paginated search by title, returning id, title, handle, status, vendor, product type, tags and variant count. Backs the "Include by Products" picker. Must support cursor pagination and a query string, and must not fetch variants it does not need.

- [ ] **Implement collection listing and search** — Paginated list of custom and smart collections with id, title and handle. Backs the "Include by Collections" picker.

- [ ] **Implement tag, vendor and product-type listing** — Distinct values for each, for the "Include by Tags, Vendors, and Product Types" picker. These are shop-wide lookups; cache them harder than product search since they change rarely.

- [ ] **Implement bulk variant price fetch** — Given a list of Shopify variant ids, return current `price`, `compareAtPrice`, `sku`, `title` and parent product title. This is what Phase 4 reads to compute `old_price` and what Phase 5 reads to fill `current_price`. Must batch ids rather than issuing one query per variant.

- [ ] **Implement variant lookup by SKU** — Given a list of SKUs, resolve them to variant ids, product ids and current prices. Backs sheet matching in Phase 5. Must return duplicates rather than silently picking one, so the caller can flag ambiguous SKUs.

- [ ] **Add a short-lived response cache** — In-memory or Redis, keyed by shop and query, with a TTL measured in seconds to minutes depending on volatility (tags/vendors long, prices very short). Prices used for an actual write must never come from cache — Phase 6 re-reads them. Done when the campaign builder stays responsive without any catalog table.

- [ ] **Build the frontend picker components** — Polaris resource pickers for products, collections, and tags/vendors/product types, with search, pagination and multi-select, backed by the endpoints above. Shared components — Phase 3 wires them into include/exclude and Phase 5 reuses the product one for match review.

- [ ] **Write integration tests against a mocked Shopify API** — Cover pagination, throttling and retry, empty results, and a revoked-token response. Assert the adapter surfaces a typed error rather than leaking a raw GraphQL payload to the controller.
