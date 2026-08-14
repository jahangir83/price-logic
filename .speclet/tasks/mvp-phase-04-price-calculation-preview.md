# Phase 4: Price Calculation & Preview

Status: Not Started
Source: plans/11-campaign-supplier-mvp.md — Phase 4

> The constitution flags this as the highest-risk component and requires full
> unit-test coverage on it. Treat the calculation as a pure function with no
> database, no Shopify client and no NestJS dependencies.

## Tasks

- [ ] **Implement the calculation pipeline as a pure function** — Signature takes a base price, optional adjustment (unit, direction, value), optional `round_to`, and the `basis`, and returns the new price. Steps in order: base → adjustment → rounding. Use a decimal library end-to-end, never JS numbers — the constitution forbids floats for currency anywhere in the stack.

- [ ] **Implement the rounding rule** — `round_to = 0.99` turns `10.20` into `10.99`, matching the reference app's stated example. Define and document the behaviour when the rounded result would move the price the wrong way (e.g. a decrease that rounds back up), and when it would produce a negative or zero price. Recommend clamping to a positive minimum and recording the row as `SKIPPED` rather than writing a nonsense price.

- [ ] **Implement the compare-at rule** — When `set_compare_at` is on, `new_compare_at_price` becomes the old price so the storefront shows a strikethrough. When a product is *already* on sale, preserve the existing compare-at as `old_compare_at_price` so revert restores the earlier sale price, not the full price. This is the behaviour the reference app describes and the reason both old columns exist.

- [ ] **Write exhaustive unit tests for the pipeline** — Full coverage, per the constitution. Cover: percentage and fixed, increase and decrease, rounding on and off, compare-at basis vs price basis, already-on-sale products, zero and null compare-at, prices that round to zero, and precision at the `numeric(19,4)` boundary. Assert exact decimal strings, never floating-point equality.

- [ ] **Implement target resolution** — Turn a campaign's `include_mode`, targets and exclusion flags into a concrete list of Shopify variant ids, using the Phase 2 read layer. Implements the contract fixed in Phase 3: exclusions always win, `exclude_draft_archived` applies independently, and collection membership is resolved at the moment of resolution. Must paginate — an `ALL_PRODUCTS` campaign on a large store is tens of thousands of variants.

- [ ] **Decide and document collection membership timing** — A campaign targeting a collection resolves its members at activation, not at creation, so products added to the collection in between are included. Write this into the phase file and the user-facing copy, because it is a behaviour merchants will ask about.

- [ ] **Build the preview endpoint** — Given a campaign id, resolve targets, fetch current prices, run the pipeline, and return a paginated list of product, variant, current price and new price. Persists nothing — no `price_changes` rows are written at preview. Must handle a campaign that resolves to zero variants as a valid empty result, not an error.

- [ ] **Enforce server-side recalculation** — Never accept a price from the client for execution. The preview response is display-only; Phase 6 recomputes from the campaign config before writing. Add a test asserting that a tampered client payload cannot influence the applied price. Constitution rule, and the highest-value test in this phase.

- [ ] **Build the preview UI** — Polaris table showing current price against new price with the difference, a total count, and a warning banner when rows were skipped and why. Paginated, since the list can be very large.
