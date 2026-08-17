# Phase 4: Price Calculation & Preview

Status: Complete
Completed: 2026-08-14
Source: plans/11-campaign-supplier-mvp.md — Phase 4

> The constitution flags this as the highest-risk component and requires full
> unit-test coverage on it. Treat the calculation as a pure function with no
> database, no Shopify client and no NestJS dependencies.

## Tasks

- [x] **Implement the calculation pipeline as a pure function** — Signature takes a base price, optional adjustment (unit, direction, value), optional `round_to`, and the `basis`, and returns the new price. Steps in order: base → adjustment → rounding. Use a decimal library end-to-end, never JS numbers — the constitution forbids floats for currency anywhere in the stack.

- [x] **Implement the rounding rule** — `round_to = 0.99` turns `10.20` into `10.99`, matching the reference app's stated example. Define and document the behaviour when the rounded result would move the price the wrong way (e.g. a decrease that rounds back up), and when it would produce a negative or zero price. Recommend clamping to a positive minimum and recording the row as `SKIPPED` rather than writing a nonsense price.

- [x] **Implement the compare-at rule** — When `set_compare_at` is on, `new_compare_at_price` becomes the old price so the storefront shows a strikethrough. When a product is *already* on sale, preserve the existing compare-at as `old_compare_at_price` so revert restores the earlier sale price, not the full price. This is the behaviour the reference app describes and the reason both old columns exist.

- [x] **Write exhaustive unit tests for the pipeline** — Full coverage, per the constitution. Cover: percentage and fixed, increase and decrease, rounding on and off, compare-at basis vs price basis, already-on-sale products, zero and null compare-at, prices that round to zero, and precision at the `numeric(19,4)` boundary. Assert exact decimal strings, never floating-point equality.

- [x] **Implement target resolution** — Turn a campaign's `include_mode`, targets and exclusion flags into a concrete list of Shopify variant ids, using the Phase 2 read layer. Implements the contract fixed in Phase 3: exclusions always win, `exclude_draft_archived` applies independently, and collection membership is resolved at the moment of resolution. Must paginate — an `ALL_PRODUCTS` campaign on a large store is tens of thousands of variants.

- [x] **Decide and document collection membership timing** — A campaign targeting a collection resolves its members at activation, not at creation, so products added to the collection in between are included. Write this into the phase file and the user-facing copy, because it is a behaviour merchants will ask about.

- [x] **Build the preview endpoint** — Given a campaign id, resolve targets, fetch current prices, run the pipeline, and return a paginated list of product, variant, current price and new price. Persists nothing — no `price_changes` rows are written at preview. Must handle a campaign that resolves to zero variants as a valid empty result, not an error.

- [x] **Enforce server-side recalculation** — Never accept a price from the client for execution. The preview response is display-only; Phase 6 recomputes from the campaign config before writing. Add a test asserting that a tampered client payload cannot influence the applied price. Constitution rule, and the highest-value test in this phase.

- [x] **Build the preview UI** — Polaris table showing current price against new price with the difference, a total count, and a warning banner when rows were skipped and why. Paginated, since the list can be very large.

## Decisions taken

**Collection membership resolves at activation, not at creation.** A product
added to a targeted collection between saving the campaign and running it *is*
included. A collection is a live set — that is what makes it useful for
"everything in Summer Sale" — and freezing its members at save time would make
a scheduled campaign quietly price yesterday's catalog. Documented in
`target-resolution.ts` and stated in the campaign form, because merchants ask.

**A floored price is recorded, not applied.** `shouldApply()` returns false for
a FLOORED row: writing zero is worse than writing nothing, because the merchant
cannot tell "free by design" from "the maths went wrong". Same for UNCHANGED —
there is nothing to send.

**Rounding that fights the adjustment is flagged, not blocked.** UP raises a
price whenever the discount is smaller than the gap to the next charm ending —
with no adjustment at all, `11.00` becomes `11.99`. The calculator emits
`ROUNDING_OPPOSED_DIRECTION` and the preview explains it; the merchant decides.
Rounding *down* with no adjustment is not flagged, because that is exactly what
"round my prices" means.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (94 files) | 0 errors, 0 warnings |
| backend: unit tests | 179 passed, 13 suites (42 new) |
| backend: integration tests | 96 passed, 5 suites |
| frontend: eslint / `tsc -b` / `vite build` | 0 errors · pass · pass |
| shared: unit tests | 102 passed (20 new) |

The calculation matrix the constitution demands, all asserting exact decimal
strings:

- every unit × direction combination
- compare-at preserved when a product is already on sale, so revert restores
  the earlier sale price rather than full price
- a zero compare-at treated as a real value, a null one left null
- the compare-at basis discounting from the original rather than the sale price
- exactly 100% off reaching zero without flooring; more than 100% floored
- `0.0001` and `999999999999999.0000` — both `numeric(19,4)` boundaries
- a value with five decimal places rejected at the edge

Targeting:

- SPECIFIC with no includes covers **nothing** — the fallback that would
  otherwise reprice the entire store
- include rows union rather than intersect
- a variant reached two ways counts once
- draft/archived dropped independently of the exclusion switch
- exclusions win over an include matching the same variant
- a variant exclusion removes one variant, not its whole product
- an apostrophe in a vendor name is escaped, not injected

And the highest-value test in the phase: **a tampered payload cannot influence
the price.** A variant carrying `newPrice: 1.0000` still prices at 80.0000,
because no endpoint accepts a price and the only inputs are the campaign row
and what Shopify reports.

## Notes for the next phase

- `CampaignPreviewService.price()` is the shared path: Phase 6 calls it and
  then writes, so the preview a merchant approves and the activation that
  follows cannot diverge in what they cover.
- Enumeration is a paged walk capped at `DEFAULT_RESOLUTION_LIMIT` (50,000
  variants). A store larger than that needs the bulk operations API; the
  preview says `truncated` rather than pretending it saw everything.
- Still unverified against a real Shopify store — the enumeration queries
  (`variantsCount`, `collection.products`, the `nodes` product fragment) are
  written from the API docs and tested against a scripted transport.
