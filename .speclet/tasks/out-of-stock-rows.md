# Stock, and not repricing what cannot be sold

Status: Complete
Completed: 2026-08-16

A dropshipper's sheet covers everything the supplier lists, including what they
cannot currently ship. Repricing those is at best pointless and at worst a
promotion pointing at something nobody can buy.

## Two different "out of stock"

They are not the same question and the sheet only answers one of them:

- **The supplier has none.** Comes from a `stock` column in their sheet. Means
  do not promote this — you cannot get it.
- **The merchant has none.** Comes from Shopify's `inventoryQuantity`, already
  selected by the SKU query and discarded by `toVariantPriceRecord`.

Both are worth acting on and both are worth showing, so a merchant can see
*which* of the two is the reason a row was left alone.

## Tasks

- [x] **Carry inventory through the Shopify layer.** `inventoryQuantity` is in
  the GraphQL selection and in `GqlVariantNode`, and `toVariantPriceRecord`
  drops it. Add it to `VariantPriceRecord`.

- [x] **Accept a `stock` column in the sheet**, optional, with the usual
  aliases. Not required — most sheets will not have one, and a sheet without it
  must keep working exactly as it does now.

- [x] **Store both on the row.** `sheet_stock` from the file, `stock_quantity`
  from Shopify at match time.

- [x] **A setting for it**, defaulting to on, because "do not reprice what I
  cannot sell" is the behaviour that was asked for — but a merchant restocking
  next week may want the sale price set anyway, and that must not require a
  deploy to allow.

- [x] **Skip on live stock at activation, not on matched stock.** The row's
  stored quantity is from whenever the sheet was matched, possibly days before
  approval. Activation already re-reads live prices for exactly this reason;
  stock rides along on the same call.

- [x] **Show it, and say why.** A stock column in the review, and a row that
  will not be updated marked as such with which of the two reasons applies.

- [x] **Tests**, including that a sheet with no stock column is unaffected.

## Decisions taken

**Skipped, never silently dropped.** The row stays in the review with a reason
attached. A merchant who uploads 500 rows and gets 380 updates needs to see the
120 and why — an invisible exclusion is the failure this whole approval screen
exists to prevent.

**Unknown stock is not zero stock.** A sheet with no `stock` column and a
variant whose inventory Shopify does not track both read as null, and null must
mean "no opinion" rather than "none". Treating unknown as out of stock would
silently stop repricing every untracked product in the store.
