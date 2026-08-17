# The sheet, and what it is being compared against

Status: Complete
Completed: 2026-08-16

Suppliers exist for merchants who do not set their own prices from scratch —
dropshippers, and anyone reselling from more than one source. They are handed a
price list and have to decide, per product, whether to follow it. That decision
is the product, and right now the screen where it happens does not show enough
to make it.

## What is already there

The Shopify side is built. Parsing spawns a `CSV_MATCH` child job, which calls
`findVariantsBySku` — a GraphQL query already selecting `product { id title }`,
variant `title` and `inventoryQuantity` — and fills `current_price` on each
row. The approval screen already puts current, sheet and new price side by
side.

## What is missing

- [x] **The example sheet.** Nothing anywhere tells a merchant what the file
  should look like. `CSV_COLUMN_ALIASES` in the shared package carries a
  comment saying it is shared *"because the upload screen shows the merchant
  which headers are expected"* — the upload screen does not. Generate both the
  documentation and a downloadable example **from those aliases**, so the
  example cannot drift from what the parser accepts.

- [x] **The product's name.** `product { title }` is fetched from Shopify and
  thrown away, because `csv_rows` has no column for it. So the comparison is a
  list of bare SKU codes: a dropshipper reviewing 400 rows can see that
  `AC-9912-BLK` is going from £14 to £17 and cannot tell what it is. Store the
  product and variant titles at match time and show them.

- [x] **The difference.** The screen shows three prices and leaves the merchant
  to subtract. What they are scanning for is which prices moved and by how
  much — that is the whole review — so show it, with the direction, and make a
  rise visually distinct from a fall.

- [x] **Sort the review by what matters.** Biggest movers first, so a sheet
  where nine hundred prices held steady and four jumped 30% does not bury the
  four.

## Decisions taken

**The example is generated, not written.** A hand-written sample CSV is a
second source of truth about the file format, and the day someone adds an alias
it silently starts lying. Building it from `CSV_COLUMN_ALIASES` means a change
to the parser changes the example.

**Titles are copied onto the row, not looked up for display.** The same reason
`price_changes` caches them: a sheet reviewed today may be approved next week,
and a product renamed in between should not make the review unreadable. It is a
record of what was compared, not a live view.
