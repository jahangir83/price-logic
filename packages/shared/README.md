# @pricelogic/shared

The contract between the NestJS API and the Vite/React admin UI.

## What lives here

| Area | Contents |
| --- | --- |
| `domain/` | One interface + enums per table, with no persistence concern. Backend entities `implements` these. |
| `dto/` | Request and response bodies for every endpoint. |
| `money/` | Exact decimal arithmetic on `bigint` minor units, plus charm-pricing rounding. |
| `pricing/` | `calculatePrice` — the single function that turns a base price into a new price. |

## What does not live here

**TypeORM entities.** They carry `@Entity` and `@Column` decorators, so
exporting them would pull `typeorm` into the browser bundle for types the
browser only needs the shape of. Entities stay in `backend/src/modules/*/entities`
and declare `implements Campaign`, which makes a column added on one side and
not the other a compile error.

**Anything that reads the clock, the network or the environment.** Every
function here is pure, so the same inputs give the same answer in Node and in
the browser.

## Why the price calculator is shared

The admin UI renders a preview table; the API writes `price_changes` and calls
Shopify. If those two ran different arithmetic, a merchant would approve one
number and get another. Sharing `calculatePrice` makes that impossible.

This does **not** weaken the constitution's rule that client-supplied prices
are never trusted for execution. The server still recalculates from its own
inputs and ignores whatever the browser computed — sharing the code only means
the two agree when the inputs do.

## Money

Every monetary value is a decimal **string** in the exact shape
`numeric(19,4)` returns. Never a JS number:

```ts
0.1 + 0.2                    // 0.30000000000000004  ✗
add('0.1', '0.2')            // '0.3000'             ✓
```

Convert to Shopify's 2 decimal places with `toShopifyPrice` immediately before
the mutation, and use `formatMoney` for display only — never feed its output
back into a calculation.

## Consuming it

It is a local npm workspace, not a published package. `npm install` at the repo
root links it into both apps; import it by name:

```ts
import { calculatePrice, type CampaignDto } from '@pricelogic/shared';
```

It is laid out as a publishable package — dual CJS/ESM build, `exports` map,
generated `.d.ts` — so if something outside this repo ever needs it, flipping
`"private": false` and running `npm publish` is the whole change.

## Working on it

```bash
npm run build:shared     # from the repo root, after changing anything here
npm run test:shared
```

The apps consume `dist/`, not `src/`, so **a change here is invisible until you
rebuild.** That is the deliberate cost of keeping the frontend's `tsconfig`
(bundler resolution, `erasableSyntaxOnly`) independent of the backend's
(CommonJS, decorators).
