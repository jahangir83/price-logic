# Tenant isolation

Every merchant-owned table has a `shop_id` column. Rule: **no query against a
shop-owned table may run without a `shopId` filter**, even implicitly.

How this is enforced from Phase 1 onward:

1. `ShopGuard` (see `src/common/auth/`) resolves the caller's `Shop` from
   their session — never from a client-supplied `shopId` — and attaches it
   to the request.
2. `@CurrentShop()` injects that resolved `Shop` into a controller method.
3. Services for shop-owned entities take `shopId` explicitly and use
   `TenantScopedRepository` instead of a raw TypeORM `Repository`, so every
   `find`/`save`/`delete` call has `shopId` merged in automatically.

A client can never pass a `shopId` that overrides the session's — controllers
must not accept `shopId` as a request parameter for scoping reads/writes.
