# 03 - Domain Model

**Product:** PriceLogic
**Company:** We Solve X Tech
**Document Type:** Domain Model
**Status:** MVP Specification
**Version:** 1.0

---

# 1. Purpose

This document defines the core business entities of PriceLogic and how they relate to each other.

This document describes **what each entity means**, not how it will be stored in a database.

Database implementation details belong in `07-database.md`.

---

# 2. Domain Overview

The PriceLogic domain can be represented as:

```text
Shop
 │
 ├── Products
 │     └── Variants
 │
 ├── Pricing Rules
 │
 ├── Campaigns
 │
 ├── Supplier Data
 │
 └── Pricing Operations
        │
        ├── Price Changes
        └── Price History
```

The Shopify store remains the external commerce platform.

PriceLogic provides the pricing management layer around it.

---

# 3. Shop

## Definition

A `Shop` represents a Shopify store connected to PriceLogic.

The Shop is the primary tenant boundary for MVP.

All merchant data must belong to a specific Shop.

---

## Responsibilities

A Shop represents:

* Shopify connection
* Store configuration
* Pricing configuration
* Pricing rules
* Supplier configuration
* Campaigns
* Pricing operations
* Product/variant references

---

## Important Principle

Data from one Shop must never be accessible to another Shop.

Tenant isolation is mandatory.

---

# 4. Merchant

A Merchant represents the business using PriceLogic.

For MVP, the Merchant and Shop relationship can remain simple.

Conceptually:

```text
Merchant
   ↓
Shop
```

Future versions may support:

```text
Merchant
   ↓
Multiple Shops
```

with shared account-level management.

---

# 5. Product

A Product represents a Shopify product.

Example:

```text
Product:
Classic T-Shirt
```

A Product contains one or more variants.

---

## Product Responsibilities

Product-level information may include:

* Shopify product ID
* Title
* Status
* Vendor
* Product type
* Collections
* Variant references

PriceLogic should avoid duplicating Shopify data unnecessarily.

Only data required for pricing operations should be persisted locally.

---

# 6. Variant

A Variant represents the actual sellable unit being priced.

Example:

```text
Classic T-Shirt

Variants:

Small / Black
Medium / Black
Large / Black
```

The Variant is the **primary pricing unit**.

---

## Variant Properties

Conceptually:

```text
Variant
 ├── Shopify ID
 ├── SKU
 ├── Barcode
 ├── Current Price
 ├── Compare-at Price
 ├── Supplier Cost
 └── Product
```

Additional Shopify data may be synchronized when required.

---

# 7. Why Variant Is the Pricing Unit

Different variants may have different:

* Supplier costs
* Selling prices
* Inventory levels
* SKUs
* Margins

Therefore:

> Pricing logic must operate on variants rather than assuming product-level pricing.

A Product is primarily a grouping/container concept.

A Variant is the financial pricing entity.

---

# 8. Supplier

A Supplier represents a source from which the merchant obtains product cost information.

Examples:

```text
Supplier A
Supplier B
Supplier C
```

A Supplier may provide:

* SKU
* Product identifier
* Cost
* Currency
* Availability

Supplier integrations are not required for MVP.

CSV import can be the first supplier-data mechanism.

---

# 9. Supplier Record

A `SupplierRecord` represents one supplier-provided pricing record.

Example:

```text
Supplier SKU: ABC-001
Cost: $110
Currency: USD
```

A Supplier Record is an input to the pricing system.

It does not automatically become a Shopify price.

---

# 10. Supplier Product Mapping

A supplier record must be mapped to a Shopify Variant before it can affect pricing.

Conceptually:

```text
Supplier Record
       ↓
Matching
       ↓
Shopify Variant
```

Possible matching identifiers:

* SKU
* Barcode
* Merchant-defined mapping

Unmatched records must remain isolated from pricing execution.

---

# 11. Pricing Rule

A Pricing Rule defines how a selling price should be calculated.

Examples:

```text
10% Markup
$20 Fixed Markup
30% Target Margin
10% Price Increase
```

---

## Rule Scope

A rule may apply at different levels:

```text
Global
Collection
Product
Variant
```

The more specific rule has higher priority.

---

# 12. Pricing Rule Types

MVP rule types:

```text
PERCENTAGE_MARKUP
FIXED_MARKUP
TARGET_MARGIN
PERCENTAGE_PRICE_ADJUSTMENT
FIXED_PRICE_ADJUSTMENT
```

Future types may include:

```text
COMPETITOR_BASED
INVENTORY_BASED
DEMAND_BASED
AI_RECOMMENDED
```

Future rule types must not be assumed by the MVP implementation.

---

# 13. Pricing Rule Scope

A Pricing Rule contains both:

```text
Rule Definition
+
Rule Scope
```

Example:

```text
Rule:
Target Margin = 30%

Scope:
Collection = Shoes
```

Another:

```text
Rule:
Markup = 25%

Scope:
Variant = ABC-123
```

---

# 14. Pricing Operation

A `PricingOperation` represents one execution request.

Examples:

```text
"Increase selected products by 10%"
"Apply supplier cost changes"
"Start Summer Sale"
```

The operation is the container for the complete pricing workflow.

---

## Operation Lifecycle

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

Possible terminal states:

```text
FAILED
CANCELLED
```

---

# 15. Pricing Operation vs Pricing Rule

These concepts must not be confused.

### Pricing Rule

Defines **how a price should be calculated**.

### Pricing Operation

Represents **an actual request to perform pricing changes**.

Example:

```text
Pricing Rule:
Target Margin = 30%

Pricing Operation:
Apply Target Margin rule to 500 variants
```

The same rule may be used by many operations.

---

# 16. Price Change

A `PriceChange` represents the result of an operation for one variant.

Example:

```text
Variant: ABC-001

Previous Price: $100
Proposed Price: $130
Final Price: $130
Status: SUCCESS
```

One Pricing Operation can contain many Price Changes.

```text
Pricing Operation
      │
      ├── Price Change
      ├── Price Change
      ├── Price Change
      └── ...
```

---

# 17. Price History

Price History represents the historical record of price changes.

It answers:

> What was the price, what changed it, and when?

Conceptually:

```text
Variant
Previous Price
New Price
Source
Operation
Timestamp
```

---

# 18. Price History vs Price Change

These concepts are related but different.

### Price Change

Belongs to a particular operation.

### Price History

Long-term historical record of successful price changes.

Example:

```text
Operation:
Summer Sale

Price Change:
$150 → $120
```

After execution:

```text
Price History:
$150 → $120
Source = CAMPAIGN
```

---

# 19. Campaign

A Campaign represents a temporary pricing strategy.

Example:

```text
Summer Sale
15% Discount
June 1 → June 30
```

A campaign contains:

* Name
* Target
* Pricing adjustment
* Start time
* End time
* Status

---

# 20. Campaign Lifecycle

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

# 21. Campaign vs Pricing Rule

A Campaign is a business event.

A Pricing Rule is a calculation definition.

Example:

```text
Campaign:
Black Friday

Rule:
15% Discount
```

The campaign activates the pricing behavior for a defined period.

---

# 22. Schedule

A Schedule represents a future execution time.

Examples:

```text
Run tomorrow at 12:00
Run every Monday
Start campaign on November 27
```

For MVP, scheduling should focus on one-time and campaign-based scheduled operations.

Recurring schedules may be introduced later.

---

# 23. Pricing Snapshot

A Pricing Snapshot represents the relevant price state captured before an operation.

This is particularly important for campaigns and rollback.

Example:

```text
Before Campaign:

Variant A → $150
Variant B → $180
Variant C → $200
```

The snapshot preserves the values required for safe restoration.

---

# 24. Import

An Import represents an external data ingestion operation.

Example:

```text
Supplier CSV Import
```

An import has:

```text
Uploaded File
↓
Parsing
↓
Validation
↓
Matching
↓
Preview
↓
Apply
```

---

# 25. Import Record

Each row in an import should have a processing state.

Possible states:

```text
VALID
INVALID
MATCHED
UNMATCHED
APPLIED
SKIPPED
FAILED
```

This allows merchants to understand what happened to each supplier record.

---

# 26. Pricing Recommendation

A future `PricingRecommendation` represents a suggested pricing action generated from analytics or AI.

Example:

```text
Product:
Running Shoes

Current Price:
$100

Recommendation:
Increase to $108

Reason:
High demand + low inventory
```

A recommendation is **not** an executed price change.

---

# 27. AI Recommendation Principle

AI recommendations must remain separate from the execution layer.

```text
Analytics
   ↓
AI
   ↓
Recommendation
   ↓
Merchant Review
   ↓
Pricing Rule / Operation
   ↓
Execution
```

AI must not directly modify Shopify prices in the MVP.

---

# 28. Entity Relationships

Conceptual relationship:

```text
Shop
 │
 ├── Products
 │     └── Variants
 │
 ├── Pricing Rules
 │
 ├── Suppliers
 │     └── Supplier Records
 │
 ├── Campaigns
 │
 ├── Imports
 │
 └── Pricing Operations
        │
        ├── Price Changes
        │       └── Variant
        │
        └── Price History
```

---

# 29. Ownership Rules

Every merchant-owned entity must be traceable to a Shop.

For example:

```text
Shop
 ├── Product
 ├── Variant
 ├── Pricing Rule
 ├── Campaign
 ├── Import
 ├── Pricing Operation
 └── Price History
```

No tenant-owned record should exist without an identifiable tenant boundary.

---

# 30. External vs Internal Data

PriceLogic interacts with two major data worlds.

### External

Shopify:

* Products
* Variants
* Prices
* Inventory
* Store configuration

Supplier:

* Costs
* SKUs
* Product data

### Internal

PriceLogic:

* Rules
* Operations
* Campaigns
* History
* Snapshots
* Imports
* Recommendations

The architecture must keep these responsibilities separate.

---

# 31. Source of Truth

For current storefront price:

```text
Shopify = External Source of Truth
```

For pricing rules:

```text
PriceLogic = Source of Truth
```

For pricing operation history:

```text
PriceLogic = Source of Truth
```

For supplier cost:

```text
PriceLogic stores the latest accepted supplier data
```

The source of truth must be explicit for every important field.

---

# 32. Domain Invariants

The following rules must always hold.

### Variant

A Variant must belong to a Product.

### Product

A Product must belong to a Shop.

### Pricing Rule

A Pricing Rule must belong to a Shop.

### Pricing Operation

A Pricing Operation must belong to a Shop.

### Price Change

A Price Change must reference a Pricing Operation and Variant.

### Campaign

A Campaign must belong to a Shop.

### Supplier Record

A Supplier Record must belong to its Supplier/Import context.

---

# 33. Domain Boundaries

The system should conceptually be divided into these domains:

```text
Shop Domain
Product Domain
Supplier Domain
Pricing Domain
Campaign Domain
Import Domain
Execution Domain
Analytics Domain
```

The MVP should keep these boundaries clear without overengineering them.

---

# 34. Pricing Domain

The Pricing Domain is the core domain.

It owns:

* Pricing Rules
* Pricing Calculations
* Pricing Operations
* Price Changes
* Price History

Other domains provide inputs to the Pricing Domain.

Example:

```text
Supplier Domain
      ↓
Supplier Cost
      ↓
Pricing Domain
      ↓
New Price
```

---

# 35. Execution Domain

The Execution Domain is responsible for applying approved pricing results to Shopify.

It should not decide pricing.

Its responsibility is:

```text
Approved Result
      ↓
Shopify Update
      ↓
Success / Failure
```

This separation is critical.

---

# 36. Import Domain

The Import Domain is responsible for:

* File ingestion
* Parsing
* Validation
* Mapping
* Matching
* Import status

It should not contain pricing calculation logic.

Once valid supplier data is available, it passes that data to the Pricing Domain.

---

# 37. Analytics Domain

Analytics is responsible for collecting and interpreting business data.

Future analytics may include:

* Revenue
* Margin
* Price changes
* Inventory
* Product performance
* Campaign performance

Analytics should not directly modify pricing.

---

# 38. Future AI Domain

The AI domain may eventually analyze:

```text
Price history
Sales performance
Inventory
Supplier costs
Campaign performance
Product performance
```

and produce recommendations.

It should communicate with the Pricing Domain through controlled interfaces.

---

# 39. Domain Flow

The ideal long-term architecture is:

```text
Shopify
   ↓
Synchronization
   ↓
PriceLogic Domain Model
   ↓
Pricing Rules
   ↓
Pricing Engine
   ↓
Pricing Result
   ↓
Merchant Approval
   ↓
Execution
   ↓
Shopify
```

Supplier flow:

```text
Supplier
   ↓
Import
   ↓
Matching
   ↓
Supplier Cost
   ↓
Pricing Engine
```

AI flow:

```text
Analytics
   ↓
AI Analysis
   ↓
Recommendation
   ↓
Merchant Approval
   ↓
Pricing Operation
```

---

# 40. Final Domain Principle

PriceLogic should maintain a strict distinction between:

```text
WHAT PRICE SHOULD IT BE?
        ↓
Pricing Domain

WHY SHOULD WE CONSIDER THAT PRICE?
        ↓
AI / Analytics / Business Rules

SHOULD WE APPLY IT?
        ↓
Merchant Approval

HOW DO WE UPDATE SHOPIFY?
        ↓
Execution Domain
```

This separation is one of the most important architectural principles of the product.

The system may become sophisticated internally, but these business responsibilities must remain clear.
