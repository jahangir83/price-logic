# Entity conventions

Every entity added from Phase 2 onward follows these rules (db #4-6):

1. **Primary keys are generated UUIDs**, never a Shopify ID:
   ```ts
   @PrimaryGeneratedColumn('uuid')
   id!: string;
   ```
   External Shopify identifiers are stored in their own `shopify_x_id` column
   (e.g. `shopify_product_id`) and are never used as the row's identity.

2. **Money is `numeric`, typed as `string` in TypeScript, never `number`.**
   ```ts
   @Column({ type: 'numeric', precision: 19, scale: 4 })
   price!: string;
   ```
   `pg`/TypeORM return `numeric` columns as strings specifically to avoid
   silently rounding through a JS float — casting to `number` anywhere in the
   money path defeats that protection, so money fields stay `string` all the
   way to the API boundary. Arithmetic on money must go through a
   decimal-safe helper (introduced with the pricing engine in Phase 4), never
   native `+`/`-`/`*`.

3. **Every table that records a money value has an explicit `currency`
   column** (`varchar`, e.g. `'USD'`) rather than assuming the shop's
   currency applies. No default currency is assumed at the query layer.

4. **Every merchant-owned table carries `shop_id`** and must be accessed via
   `TenantScopedRepository` (see `src/common/tenant/`) — never a raw
   `Repository` for a shop-owned entity.

These conventions apply to every entity under `src/modules/*/entities/`.
