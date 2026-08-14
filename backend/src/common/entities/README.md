# Entity conventions

## The shape lives in `@pricelogic/shared`

An entity is persistence only. Its **field shape and every enum** come from
`packages/shared` and the class declares `implements`:

```ts
import { CampaignStatus, type Campaign as CampaignModel } from '@pricelogic/shared';

@Entity('campaigns')
export class Campaign implements CampaignModel { … }
```

That is not decoration — it is the guard rail. Add a column here without
adding it to the shared model, change a type on one side only, and the build
fails, so the admin UI's type can never quietly drift from the table. Both
directions are covered: a missing property and a mismatched one each produce a
compile error.

So the order of work is: **shared model first, entity second, migration third.**

Entities themselves never move into the shared package — their decorators
would drag `typeorm` into the browser bundle. Re-export the enums from the
entity file (`export { CampaignStatus }`) so backend code can keep importing
from one place.

## The rest

Every entity added from Phase 2 onward follows these rules (db #4-6):

1. **Primary keys are generated UUIDs**, never a Shopify ID:
   ```ts
   @PrimaryGeneratedColumn('uuid')
   id!: string;
   ```
   External Shopify identifiers are stored in their own `shopify_x_id` column
   (e.g. `shopify_product_id`) and are never used as the row's identity.

2. **Money is `numeric`, typed as `Money` in TypeScript, never `number`.**
   ```ts
   import type { Money } from '@pricelogic/shared';

   @Column({ type: 'numeric', precision: 19, scale: 4 })
   price!: Money;
   ```
   `Money` is a `string` alias, so this changes nothing at runtime — it names
   the invariant. `pg`/TypeORM return `numeric` columns as strings
   specifically to avoid silently rounding through a JS float, so casting to
   `number` anywhere in the money path defeats that protection and money stays
   a string all the way to the API boundary.

   Arithmetic goes through `@pricelogic/shared`'s money module (`add`,
   `subtract`, `percentOf`, …), which operates on `bigint` minor units — never
   native `+`/`-`/`*`. Call `toShopifyPrice` immediately before a Shopify
   mutation to drop to 2 decimal places, and `formatMoney` for display only.

3. **Every table that records a money value has an explicit `currency`
   column** (`varchar`, e.g. `'USD'`) rather than assuming the shop's
   currency applies. No default currency is assumed at the query layer.

4. **Every merchant-owned table carries `shop_id`** and must be accessed via
   `TenantScopedRepository` (see `src/common/tenant/`) — never a raw
   `Repository` for a shop-owned entity.

These conventions apply to every entity under `src/modules/*/entities/`.
