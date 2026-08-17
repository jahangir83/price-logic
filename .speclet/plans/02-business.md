# 02 - Business Logic

**Product:** PriceLogic
**Company:** We Solve X Tech
**Document Type:** Business Logic / Domain Behavior
**Status:** MVP Definition
**Version:** 1.0

---

# 1. Purpose

PriceLogic exists to help Shopify merchants manage product pricing at scale while reducing manual work and protecting profitability.

The core business problem is:

> A merchant needs to change prices across many Shopify variants based on business rules, supplier cost changes, promotions, or scheduled campaigns without manually calculating and editing every variant.

PriceLogic turns this manual process into a controlled workflow.

---

# 2. Business Model

PriceLogic is a SaaS application for Shopify merchants.

A merchant installs PriceLogic on their Shopify store and uses the platform to manage pricing operations.

The merchant pays a recurring subscription based on the pricing/automation capabilities and potentially usage limits defined by the product's pricing plans.

The application must provide recurring value.

The merchant should continue using PriceLogic because it saves operational time and helps them manage pricing safely.

---

# 3. Core Business Value

PriceLogic provides four primary business values.

## 3.1 Time Saving

Instead of manually editing hundreds or thousands of variants, the merchant can apply one pricing operation to many variants.

Example:

```text
Manual:

Product 1 → Edit
Product 2 → Edit
Product 3 → Edit
...
Product 5,000 → Edit
```

PriceLogic:

```text
Select Products
        ↓
Choose Pricing Rule
        ↓
Preview
        ↓
Apply
```

---

## 3.2 Profit Protection

The merchant can define minimum profitability requirements.

Example:

```text
Supplier Cost = $100

Minimum Margin = 20%

Selling Price must satisfy the merchant's margin requirement.
```

The system must prevent or flag pricing operations that violate configured business rules.

---

## 3.3 Pricing Automation

Merchants can schedule pricing operations.

Example:

```text
Black Friday Campaign

Start:
November 27, 00:00

Discount:
15%

End:
November 30, 23:59

Action:
Restore previous prices
```

The merchant should not need to manually perform the start and end operations.

---

## 3.4 Operational Safety

Price changes affect revenue.

Therefore PriceLogic should make pricing changes visible, predictable, and auditable.

The merchant should know:

* What will change
* Why it will change
* Old price
* Proposed price
* Expected margin
* Which rule caused the change

before an important pricing operation is executed.

---

# 4. Core Business Entities

The core business concepts are:

```text
Merchant
    ↓
Shop
    ↓
Product
    ↓
Variant
    ↓
Pricing Rule
    ↓
Pricing Operation
    ↓
Price Change
    ↓
Price History
```

Additional concepts:

```text
Supplier
Supplier Product Data
Pricing Campaign
Scheduled Job
Pricing Snapshot
```

---

# 5. Merchant

A merchant is the business owner or operator using PriceLogic.

A merchant may have one or more Shopify stores depending on the final product architecture.

For MVP, the system should primarily optimize for one Shopify store per app installation.

A merchant can:

* Configure pricing rules
* Import supplier data
* Select products
* Preview pricing changes
* Approve changes
* Schedule campaigns
* View pricing history
* Roll back supported changes

---

# 6. Shopify Store

A Shopify store is the ecommerce store connected to PriceLogic.

PriceLogic must maintain a reliable relationship between its internal representation and Shopify's product/variant data.

Important external identifiers may include:

* Shopify product ID
* Shopify variant ID
* SKU
* Barcode

Shopify remains the source of truth for the actual storefront price.

PriceLogic stores the information required to calculate, preview, execute, and audit pricing operations.

---

# 7. Product and Variant Model

Pricing operations must ultimately operate at the **variant level**.

A product can contain multiple variants.

Example:

```text
T-Shirt
│
├── Small / Black
├── Small / White
├── Medium / Black
├── Medium / White
└── Large / Black
```

Each variant may have:

* Different SKU
* Different cost
* Different selling price
* Different inventory
* Different pricing requirements

Therefore, pricing calculations must not assume that every variant of a product has the same cost or price.

---

# 8. Supplier Cost Workflow

> **Superseded, 2026-08-16.** The MVP carries *final prices* in supplier
> sheets, not costs — see §33. This section describes the cost-based design,
> which remains a live option but is not what is built.

One important PriceLogic workflow is supplier cost synchronization.

The merchant receives supplier pricing data.

Example:

```text
SKU       Supplier Cost

TS-BLK-S      10
TS-BLK-M      11
TS-WHT-S      10
TS-WHT-M      12
```

The merchant imports this data into PriceLogic.

PriceLogic then:

1. Reads the supplier data.
2. Identifies the configured matching identifier.
3. Finds the corresponding Shopify variant.
4. Compares the previous supplier cost with the new cost.
5. Detects cost changes.
6. Calculates the impact on pricing.
7. Applies the merchant's pricing rules.
8. Generates proposed selling prices.
9. Shows the merchant a preview.

---

# 9. Product Matching

Supplier products must be matched to Shopify variants.

The preferred matching identifier is configurable.

Possible identifiers:

1. SKU
2. Barcode
3. Supplier SKU mapped to Shopify SKU
4. Merchant-defined mapping

Example:

```text
Supplier SKU:
ABC-001

Shopify SKU:
ABC-001

Result:
MATCHED
```

If no match exists:

```text
Supplier SKU:
ABC-999

Shopify:
No matching variant

Result:
UNMATCHED
```

Unmatched records must never silently update unrelated Shopify variants.

---

# 10. Cost Change Detection

PriceLogic must distinguish between:

### No Change

```text
Previous Cost: $100
New Cost:      $100

Result:
No pricing action required.
```

### Cost Increased

```text
Previous Cost: $100
New Cost:      $120

Result:
Cost increased by 20%.
```

### Cost Decreased

```text
Previous Cost: $100
New Cost:      $80

Result:
Cost decreased by 20%.
```

The system may then calculate a new proposed selling price according to the merchant's pricing rules.

---

# 11. Selling Price

The selling price is the price presented to customers through Shopify.

PriceLogic must distinguish:

```text
Supplier Cost
      ≠
Selling Price
      ≠
Discounted/Campaign Price
```

These values have different business meanings.

---

# 12. Margin

Margin is used to determine whether a proposed selling price satisfies the merchant's profitability requirements.

For a simple cost/selling-price model:

```text
Profit = Selling Price - Cost
```

Gross margin percentage:

```text
Margin % =
((Selling Price - Cost) / Selling Price) × 100
```

Example:

```text
Cost = $100
Selling Price = $150

Profit = $50

Margin =
($50 / $150) × 100
= 33.33%
```

The pricing engine must use the documented margin definition consistently throughout the application.

Future versions may support additional costs such as:

* Shipping
* Payment processing
* Marketplace fees
* Taxes
* Advertising cost

These should not be assumed in the MVP unless explicitly configured.

---

# 13. Pricing Rules

A pricing rule determines how PriceLogic calculates a proposed selling price.

Examples:

### Percentage Markup

```text
Cost = $100
Markup = 30%

Proposed Price = $130
```

### Fixed Markup

```text
Cost = $100
Fixed Markup = $25

Proposed Price = $125
```

### Margin Target

```text
Cost = $100
Target Margin = 30%

Required Price =
100 / (1 - 0.30)

= $142.86
```

The distinction between **markup** and **margin** must always be preserved.

They are not the same calculation.

---

# 14. Pricing Operation

A Pricing Operation represents a pricing action performed by the merchant or an automation.

Examples:

* Increase prices
* Decrease prices
* Apply pricing rule
* Supplier cost repricing
* Start campaign
* End campaign
* Restore prices

A pricing operation should have a lifecycle.

```text
DRAFT
   ↓
PREVIEW
   ↓
APPROVED
   ↓
QUEUED
   ↓
PROCESSING
   ↓
COMPLETED
```

Possible failure state:

```text
FAILED
```

Possible cancellation state:

```text
CANCELLED
```

---

# 15. Preview Requirement

Before a significant bulk pricing operation is executed, PriceLogic should generate a preview.

Example:

```text
SKU       Old Price    New Price    Margin

A-001     $100         $120         16.67%
A-002     $150         $180         22.22%
A-003     $200         $250         20.00%
```

The merchant should be able to review the changes.

The preview should identify:

* Price increases
* Price decreases
* Unchanged items
* Rule violations
* Unmatched products
* Invalid data

---

# 16. Approval

The merchant approves a pricing operation after reviewing the preview.

Approval means:

> The merchant has accepted the proposed changes and PriceLogic may execute the operation.

The system must not assume that preview automatically means approval.

---

# 17. Bulk Update

After approval, PriceLogic sends the required updates to Shopify.

Because bulk operations may contain hundreds or thousands of variants, execution should be asynchronous.

Conceptually:

```text
Approved Operation
        ↓
Create Job
        ↓
Process Variants
        ↓
Update Shopify
        ↓
Record Result
        ↓
Complete Operation
```

The user interface should show progress and final results.

---

# 18. Price History

Every successful price change should create an auditable record.

A history record should conceptually contain:

```text
Variant
Previous Price
New Price
Reason
Operation
Pricing Rule
Timestamp
Source
```

Possible sources:

```text
MANUAL
RULE
SUPPLIER_IMPORT
CAMPAIGN
SCHEDULE
AUTOMATION
```

This allows the merchant to understand why a price changed.

---

# 19. Rollback

Where technically and logically safe, PriceLogic should allow a merchant to restore a previous price.

Example:

```text
Before:
$150

Campaign:
$120

Rollback:
$150
```

Rollback must use stored price history rather than guessing the previous price.

The system must protect against accidentally restoring an obsolete price if another pricing operation has occurred afterward.

---

# 20. Pricing Campaigns

A campaign is a scheduled pricing operation with a defined start and end.

Example:

```text
Campaign:
Summer Sale

Target:
Selected Products

Discount:
15%

Start:
June 1

End:
June 30
```

Campaign lifecycle:

```text
DRAFT
   ↓
SCHEDULED
   ↓
ACTIVE
   ↓
COMPLETED
```

Possible states:

```text
CANCELLED
FAILED
```

---

# 21. Campaign Restoration

When a temporary campaign changes prices, the system should preserve the relevant previous prices.

At campaign completion, PriceLogic can restore the stored previous prices.

However, restoration must verify that another pricing operation has not intentionally changed the price after the campaign started.

Example:

```text
Original:
$150

Campaign:
$120

During campaign:
Merchant manually changes price to $140

Campaign ends
```

PriceLogic must not blindly overwrite `$140` with `$150`.

The system must detect the conflict and handle it according to the documented campaign restoration policy.

---

# 22. Pricing Rule Priority

Multiple rules may apply to the same variant.

The system must have a deterministic rule priority system.

Example:

```text
Global Rule
    ↓
Collection Rule
    ↓
Product Rule
    ↓
Variant Rule
    ↓
Campaign Rule
```

The exact priority order will be finalized in `05-pricing-engine.md`.

The system must never randomly choose between conflicting rules.

---

# 23. Rule Conflicts

Example:

```text
Rule A:
Increase price by 10%

Rule B:
Minimum margin = 30%

Rule C:
Campaign discount = 15%
```

PriceLogic must determine:

* Which rule runs first
* Which rule overrides another
* Whether rules can be combined
* What happens when rules conflict
* What happens when a result violates minimum margin

These behaviors must be deterministic and documented.

---

# 24. Error Handling

The system must clearly distinguish:

### Validation Error

The input is invalid.

Example:

```text
Supplier cost is negative.
```

### Matching Error

No Shopify variant matches the supplier record.

### Business Rule Error

The proposed price violates a merchant rule.

### Shopify Error

Shopify rejected the update.

### System Error

Unexpected application failure.

Errors must be visible and actionable.

---

# 25. No Silent Data Changes

PriceLogic must never silently modify merchant pricing.

Every automated price change must have:

* A reason
* A source
* A rule or operation
* A timestamp
* A history record

This is a core trust principle.

---

# 26. Supplier Data Is Not Always Truth

Supplier data should be treated as an input, not automatically as a command.

Example:

```text
Supplier accidentally sends:

Cost = $0

```

PriceLogic must not automatically reprice the product to an invalid value.

Input validation must happen before pricing calculations.

---

# 27. Financial Safety

Pricing operations are financially sensitive.

Therefore:

* Negative prices are invalid.
* Invalid costs are rejected.
* Unexpected extreme changes should be flagged.
* Minimum margin rules should be respected.
* Large bulk changes should be clearly previewed.
* Failed updates must be visible.
* Partial failures must be reported.

---

# 28. Merchant Experience

The merchant should not need to understand the internal architecture.

The interface should communicate in business language.

Bad:

```text
RuleExecutionJob failed with status 422.
```

Better:

```text
23 products could not be updated because
their prices would fall below your minimum margin.
```

The product should feel simple even when the underlying system is complex.

---

# 29. Core Business Loop

The most important business loop is:

```text
Merchant has pricing problem
        ↓
PriceLogic analyzes the products
        ↓
PriceLogic calculates proposed changes
        ↓
Merchant reviews
        ↓
Merchant approves
        ↓
PriceLogic updates Shopify
        ↓
Merchant saves time / protects profit
        ↓
Merchant returns for the next pricing operation
```

This recurring workflow is the foundation of the SaaS business.

---

# 30. Long-Term Business Expansion

Once the core pricing workflow is reliable, PriceLogic may expand into:

```text
Pricing Automation
        ↓
Supplier Cost Intelligence
        ↓
Profit Intelligence
        ↓
Campaign Automation
        ↓
Inventory-aware Pricing
        ↓
Competitor Intelligence
        ↓
AI Pricing Recommendations
```

Each expansion must build on the same core pricing platform.

---

# 31. Business Rule: Do Not Overbuild

The MVP should solve one core problem exceptionally well:

> **Help Shopify merchants change large numbers of product prices safely, according to business rules, without doing the work manually.**

Everything else is secondary until real merchants demonstrate demand.

---

# 32. Final Business Principle

PriceLogic is not fundamentally a "price changing tool."

It is a system that helps merchants answer:

> **"What should my product price be, and how can I change thousands of prices safely and efficiently?"**

That is the core business problem PriceLogic exists to solve.

---

# 33. Supplier Sheet Import — the contract

> Added 2026-08-16. Section 8 above describes a **cost-based** supplier
> workflow. That is not what was built, and the difference is deliberate — see
> "The cost question" below before treating §8 as current.

## 33.1 What a supplier sheet carries today

The sheet states **the price the merchant should sell at**, not what the
merchant pays. `plans/11-campaign-supplier-mvp.md` §4 decided this explicitly:
no cost, no margin, no markup rules. The campaign's own adjustment is what puts
a markup on top, which is how "supplier's list plus 20%" is expressed.

| Column | Required | Aliases accepted | Meaning |
|---|---|---|---|
| `sku` | yes | `variant_sku`, `item_number`, `item_code` | Matched against the Shopify variant SKU |
| `price` | yes | `new_price`, `unit_price`, `selling_price` | The final selling price, before any campaign adjustment |
| `compare_at_price` | no | `msrp`, `rrp`, `list_price` | Shown struck through beside the price |
| `stock` | no | `quantity`, `qty`, `available`, `inventory`, `stock_level` | Supplier availability. Zero leaves the row alone |

Header matching ignores case, spaces and underscores. The canonical list lives
in `CSV_COLUMN_ALIASES` in `@pricelogic/shared`, and the downloadable example
on the upload screen is generated from it, so neither can drift from the parser.

## 33.2 Validation

Per-row, never per-file. One bad line must not cost the merchant the other
4,999.

- Missing SKU, missing price, unparseable price, negative price, zero price →
  the row is `INVALID` with a specific reason, and every other row continues.
- A missing `sku` or `price` **column** is the one fatal error: that file is not
  a supplier sheet.
- `stock` never fails a row. It is optional, and a supplier writing "call us"
  has still sent a usable price.
- Currency symbols and thousands separators are stripped. `1.234,56` is
  **rejected rather than guessed** — European and US conventions are ambiguous
  at a glance and guessing wrong reprices a catalogue by a factor of a hundred.
- Two rows for one SKU flag **both**. The last one does not win.

## 33.3 Product matching

Today: **SKU only**, exact match, via one Shopify GraphQL query per batch of
SKUs. A SKU resolving to more than one variant is flagged, never guessed —
repricing whichever Shopify returned first is exactly the invisible wrong
answer the approval screen exists to prevent.

**Built 2026-08-16**, rungs 1–3. A matching ladder, tried in order, each rung
seeing only the rows every rung before it failed:

1. **Merchant SKU** — the merchant's own SKU, when the supplier echoes it back.
2. **Supplier SKU** — the supplier's code, via a stored per-supplier mapping.
3. **Barcode / UPC / EAN** — the strongest identifier of the three, because it
   is assigned by the manufacturer rather than by either party.
4. **Manual mapping** — for the remainder, saved so it is answered once.
   **Not built.** Needs a variant picker and a persisted per-supplier mapping,
   which is a feature rather than a rung.

Which rung answered is recorded on the row and shown in the review, because the
rungs are not equally trustworthy: a barcode match means the merchant's own SKU
did not match, and that is worth a second look before approving.

## 33.4 Supplier column profiles

**Not built.** A supplier who titles their column "Unit Price" every month
should be mapped once, not re-mapped every month. Stored per supplier, so the
mapping is a property of who sent the file rather than of the file.

This extends the existing alias system rather than replacing it: aliases handle
what is common across suppliers, a profile handles what is peculiar to one.

## 33.5 The flow, as built

```
upload → parse (job) → match against Shopify (job) → review → approve
      → campaign created → preview → activate → Shopify updated
```

Parse and match are separate jobs on purpose: parsing is local and fast,
matching calls Shopify and can be throttled for minutes. Splitting them means a
rate limit never forces a re-parse.

Out-of-stock rows are skipped at activation on **live** stock, not on the stock
recorded at match time — a sheet approved a week after it was matched must not
act on a week-old count.

## 33.6 The cost question

An independent review (2026-08-16) recommended a cost-based format —
`supplier_sku, product_name, cost_price, currency, stock_qty, barcode` — with
cost-change detection driving pricing rules. That is not a new idea: it is
§8 of this very document, which the MVP superseded.

Both designs are defensible. What matters is that the difference is not a
column:

- **Final-price sheets** (built) — the supplier states the answer. Simple,
  works today, and cannot compute a margin because it never knows a cost.
- **Cost-price sheets** (§8) — the supplier states the input. Enables margin
  floors, "price = cost × 1.4" rules, and profitability reporting. Requires
  cost storage and history, cost-change detection, margin rules in the price
  calculator, and currency conversion when the supplier bills in another
  currency.

`minimumMarginPercent` already exists as a setting and is **stored but not
enforced**, precisely because there is no cost to compute a margin against.
That field is the seam where this decision lands.

**This is an open product decision, not a backlog item.** Adopting cost pricing
touches the money paths, which is the most sensitive code in the system, so it
should be taken deliberately and as its own phase — not folded into an import
change.

## 33.7 Fields deliberately not adopted

`MOQ`, `lead time`, `brand`, `category` and `last updated` are all real columns
on real supplier sheets, and none of them change a price. They are ignored
rather than stored: a field nothing reads is a field that goes stale and is
then trusted anyway.

`currency` is a special case — harmless while sheets carry final prices in the
shop's own currency, and load-bearing the moment costs arrive in another.
