# The matching ladder

Status: Complete
Completed: 2026-08-16

Matching is SKU-only, exact. Every row whose SKU does not appear in the store
comes back `UNMATCHED` with nothing further tried — and unmatched rows are the
largest source of wasted merchant effort in the whole import path, because each
one is a product the merchant has to find and fix by hand.

Recommended in `plans/02-business.md` §33.3, and additive: it does not depend on
the open cost-price question in §33.6.

## The ladder

Tried in order, per row, stopping at the first rung that gives exactly one
variant:

1. **`sku`** — the merchant's own SKU. What is matched today.
2. **`supplier_sku`** — the supplier's code, tried against the store's SKU
   field, because plenty of merchants use their supplier's code as their SKU.
3. **`barcode`** — UPC, EAN or GTIN. The strongest of the three: it is assigned
   by the manufacturer rather than by either party, so it survives both sides
   renaming their codes.

Manual mapping is the fourth rung and is **not** in this phase. It needs a
variant picker, a persisted per-supplier mapping and a re-match, which is a
feature rather than a step — and the first three rungs are what decide how many
rows ever reach it.

## Tasks

- [x] **Two new optional sheet columns**, `supplier_sku` and `barcode`, with
  aliases. A sheet with neither must behave exactly as it does now.

- [x] **Barcode on the Shopify side.** `barcode` is not in the variant
  selection; add it, and a lookup that queries by it.

- [x] **Record how each row matched.** Without it a merchant cannot tell a
  confident SKU match from a barcode fallback, and the fallbacks are exactly
  the ones worth a second look.

- [x] **Rewrite `match` as the ladder**, with each rung querying only the rows
  the previous one failed — so a sheet that matches fully on SKU costs exactly
  what it costs today.

- [x] **Keep ambiguity fatal at every rung.** More than one variant is flagged,
  never guessed, however far down the ladder it happens.

- [x] **Show it in the review**, and say when a row matched by something other
  than its SKU.

- [x] **Tests** on rung order, short-circuiting, ambiguity at each rung, and a
  sheet with none of the new columns.

## Decisions taken

**Order is confidence, not convenience.** The merchant's own SKU is what they
maintain, so it wins. Barcode is the most reliable identifier in the abstract
but sits last, because a merchant who has deliberately given two variants the
same barcode — a common enough data state — should not have that outrank the
SKU they set themselves.

**A rung never overrides a match.** Once a row has exactly one variant it is
finished. Later rungs only ever see rows that found nothing.
