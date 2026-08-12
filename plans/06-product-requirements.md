# 06 - Product Requirements

**Product:** PriceLogic
**Company:** We Solve X Tech
**Document Type:** Product Requirements / MVP Specification
**Status:** MVP
**Version:** 1.0

---

# 1. Purpose

This document defines what must be built for the first production-ready version of PriceLogic.

It converts the business requirements and user flows into actionable product requirements.

The MVP must remain focused.

The goal is not to build every possible pricing feature.

The goal is to build a reliable pricing automation workflow that real Shopify merchants can use.

---

# 2. MVP Product Goal

The MVP must allow a Shopify merchant to:

```text
Connect Shopify
    ↓
Sync Products
    ↓
Configure Pricing
    ↓
Select Variants
    ↓
Calculate New Prices
    ↓
Preview Changes
    ↓
Approve
    ↓
Update Shopify
    ↓
View History
```

The merchant must be able to complete this workflow without developer assistance.

---

# 3. MVP Feature List

## P0 — Required

The following features are mandatory:

1. Shopify installation/authentication
2. Store initialization
3. Product synchronization
4. Variant synchronization
5. Product/variant search
6. Product selection
7. Pricing rule creation
8. Percentage price increase
9. Percentage price decrease
10. Fixed price increase
11. Fixed price decrease
12. Percentage markup
13. Fixed markup
14. Target margin pricing
15. Minimum price protection
16. Maximum price protection
17. Minimum margin protection
18. Price preview
19. Pricing operation creation
20. Merchant approval
21. Shopify price execution
22. Execution progress
23. Operation result
24. Price history
25. Basic rollback
26. Supplier CSV import
27. CSV column mapping
28. Supplier SKU matching
29. Supplier cost change detection
30. Supplier-based repricing
31. Scheduled pricing operation
32. Campaign start/end
33. Campaign price restoration

---

# 4. P1 — After MVP

These should not block the initial launch:

* Advanced analytics
* Advanced filtering
* Recurring pricing rules
* Advanced campaign segmentation
* Multiple supplier integrations
* More sophisticated rollback
* Competitor price monitoring
* Inventory-based rules

---

# 5. P2 — Future

Potential future features:

* AI pricing recommendations
* Dynamic pricing
* Demand-based pricing
* Competitor intelligence
* Automated supplier integrations
* Predictive pricing
* Advanced profit optimization

---

# 6. Shopify Installation

## Requirement

A merchant must be able to install PriceLogic on a Shopify store.

## Expected Behavior

After installation:

1. Store is identified.
2. Required authorization is completed.
3. Shop record is created.
4. Initial synchronization can begin.

## Acceptance Criteria

* The store can successfully install the app.
* The app identifies the correct Shopify store.
* Store-specific data is isolated.
* Authentication failures are handled clearly.
* Reinstallation/reconnection does not create uncontrolled duplicate tenant records.

---

# 7. Store Initialization

After installation, PriceLogic must initialize the store.

Initialization includes:

* Store configuration
* Default pricing settings
* Initial product sync
* Initial variant sync

The merchant should see initialization progress.

---

# 8. Product Synchronization

## Requirement

PriceLogic must synchronize the Shopify products required for pricing operations.

## Minimum Data

The local representation should support:

* Shopify product ID
* Title
* Status
* Vendor
* Product type
* Variant references

## Acceptance Criteria

* Products are synchronized correctly.
* Existing products are updated instead of duplicated.
* Deleted/unavailable products are handled safely.
* Sync failures are visible.
* A merchant can see sync status.

---

# 9. Variant Synchronization

Variants are the primary pricing unit.

The system must synchronize:

* Shopify variant ID
* Product relationship
* SKU
* Barcode where available
* Current price
* Compare-at price where applicable
* Relevant cost information where available

Acceptance criteria:

* Variants remain associated with the correct product.
* Shopify IDs remain stable identifiers.
* Price synchronization does not silently overwrite internal pricing history.

---

# 10. Product Search

The merchant must be able to search products.

Minimum search fields:

* Product title
* SKU
* Variant SKU

Future search fields may include:

* Vendor
* Collection
* Product type

---

# 11. Product Selection

Merchant must be able to select:

* Individual products
* Individual variants
* Multiple products
* Filtered results

The interface must display the number of affected variants.

---

# 12. Pricing Rule Creation

Merchant must be able to create a reusable pricing rule.

A rule must contain:

* Name
* Type
* Value
* Scope
* Optional protection settings
* Status

Possible statuses:

```text
ACTIVE
INACTIVE
```

---

# 13. Percentage Price Increase

Merchant can increase the current selling price by a percentage.

Example:

```text
Current = $100
Increase = 10%

Result = $110
```

Acceptance criteria:

* Calculation is correct.
* Preview shows the result.
* No Shopify update occurs before approval.

---

# 14. Percentage Price Decrease

Example:

```text
Current = $100
Decrease = 10%

Result = $90
```

Negative or zero results must be rejected unless explicitly supported.

---

# 15. Fixed Price Increase

Example:

```text
Current = $100
Increase = $20

Result = $120
```

---

# 16. Fixed Price Decrease

Example:

```text
Current = $100
Decrease = $20

Result = $80
```

The system must prevent invalid final prices.

---

# 17. Percentage Markup

Markup is calculated from cost.

```text
Cost = $100
Markup = 25%

Result = $125
```

The system must not confuse markup with margin.

---

# 18. Fixed Markup

Example:

```text
Cost = $100
Fixed Markup = $30

Result = $130
```

---

# 19. Target Margin

Merchant can define a target margin.

Formula:

```text
Price =
Cost / (1 - Margin)
```

Example:

```text
Cost = $100
Target Margin = 30%

Price = $142.86
```

---

# 20. Pricing Protections

The merchant can configure:

### Minimum Price

Price cannot fall below configured value.

### Maximum Price

Price cannot exceed configured value.

### Minimum Margin

Calculated margin cannot fall below configured threshold.

The default MVP behavior for minimum margin should be protective rather than silently changing the merchant's intended price.

---

# 21. Price Preview

Every bulk pricing operation must support preview before execution.

Preview must show:

* Variant
* SKU
* Current price
* Proposed price
* Cost
* Profit
* Margin
* Applied rule
* Status

The preview must not modify Shopify.

---

# 22. Preview Filtering

The merchant should be able to identify:

* Ready changes
* Unchanged variants
* Margin violations
* Invalid prices
* Missing costs
* Unmatched records

Advanced filtering is optional for the first MVP.

---

# 23. Pricing Operation

When the merchant creates a pricing change, PriceLogic creates a Pricing Operation.

The operation must track:

* Target variants
* Pricing configuration
* Calculation result
* Approval state
* Execution state
* Final result

---

# 24. Approval

Approval must be explicit.

The merchant must confirm before the system updates Shopify.

The system must not interpret:

* Preview generation
* Page navigation
* Rule creation

as approval.

---

# 25. Shopify Execution

After approval, PriceLogic executes the approved price changes.

Requirements:

* Process variants safely.
* Handle Shopify API failures.
* Retry transient failures.
* Track successful updates.
* Track failed updates.
* Avoid duplicate execution.

---

# 26. Execution Progress

For large operations, the merchant must see progress.

Example:

```text
Updating prices...

1,240 / 2,000 variants
```

The progress must represent actual processing state as accurately as practical.

---

# 27. Operation Result

After execution, display:

```text
Total
Successful
Failed
Skipped
Unchanged
```

The merchant must be able to inspect failed records.

---

# 28. Price History

Every successful price change must produce a history record.

Minimum information:

* Variant
* Previous price
* New price
* Source
* Operation
* Timestamp

---

# 29. Rollback

The merchant can request rollback for supported price changes.

Before rollback:

1. Identify original price.
2. Check current Shopify price.
3. Detect possible conflicts.
4. Generate rollback preview.
5. Require confirmation.
6. Execute rollback.

Rollback must not blindly overwrite a newer merchant price.

---

# 30. Supplier CSV Import

Merchant must be able to upload supplier pricing data.

Supported initial format:

```text
CSV
```

Minimum required supplier information:

```text
SKU
Cost
```

---

# 31. CSV Column Mapping

The merchant must be able to map CSV columns.

Example:

```text
Supplier Column:
Product Code

Maps To:
SKU
```

and:

```text
Supplier Column:
Unit Cost

Maps To:
Cost
```

---

# 32. CSV Validation

The importer must validate:

* Required columns
* Empty SKU
* Empty cost
* Invalid cost
* Negative cost
* Duplicate SKU
* Invalid file format

Invalid rows must not be applied.

---

# 33. Supplier Matching

The MVP should primarily support SKU-based matching.

Flow:

```text
Supplier SKU
     ↓
Shopify Variant SKU
     ↓
Match
```

Unmatched records must be reported.

---

# 34. Supplier Cost Change Detection

The system must compare:

```text
Previous Supplier Cost
vs
New Supplier Cost
```

Possible states:

```text
UNCHANGED
INCREASED
DECREASED
NEW
```

---

# 35. Supplier Repricing

After supplier costs are accepted, PriceLogic can calculate proposed selling prices according to the merchant's configured pricing strategy.

Example:

```text
Cost:
$100 → $120

Strategy:
30% Target Margin

Proposed:
$171.43
```

The merchant must preview and approve the changes before Shopify execution.

---

# 36. Scheduled Operations

The merchant can schedule a pricing operation for a future time.

Minimum configuration:

* Operation
* Target
* Pricing rule
* Execution time
* Timezone

Before execution, the system must revalidate relevant data.

---

# 37. Campaigns

Merchant can create a temporary pricing campaign.

Minimum campaign data:

* Name
* Target
* Pricing adjustment
* Start time
* End time
* Status

---

# 38. Campaign Execution

At start:

```text
Validate
→ Calculate
→ Execute
→ Record
```

At end:

```text
Validate restoration
→ Restore eligible prices
→ Record result
```

---

# 39. Campaign Conflict

If the current Shopify price differs from the price applied by the campaign, the system must detect the conflict.

Example:

```text
Campaign applied:
$120

Current Shopify price:
$140
```

The system must not automatically assume that `$120` should be restored.

---

# 40. Notifications

The MVP should provide clear in-app status for:

* Sync completed
* Operation completed
* Operation failed
* Campaign started
* Campaign completed
* Import completed

Email notifications may be added later.

---

# 41. Audit Trail

Important actions must be auditable.

Examples:

```text
Rule created
Rule updated
Operation approved
Operation executed
Campaign started
Campaign ended
Rollback executed
```

---

# 42. Permissions

For MVP, the application may use a simplified merchant/admin permission model.

Future versions may support:

* Owner
* Admin
* Manager
* Operator
* Viewer

Permission architecture should not prevent future expansion.

---

# 43. Performance Requirements

The system must support bulk operations without requiring the merchant to keep the browser open continuously.

Long-running operations must be handled asynchronously.

The UI should be able to retrieve operation progress.

---

# 44. Reliability Requirements

The system must:

* Avoid duplicate pricing operations.
* Handle retryable failures.
* Preserve operation state.
* Record partial failures.
* Avoid silent Shopify changes.
* Preserve pricing history.

---

# 45. Security Requirements

The application must:

* Isolate merchant data.
* Secure Shopify credentials/tokens.
* Validate uploaded files.
* Validate all pricing inputs.
* Prevent unauthorized pricing operations.
* Protect internal APIs.

Security details belong in `10-security.md`.

---

# 46. Non-Functional Product Requirements

The MVP should be:

### Reliable

Pricing operations must produce trustworthy results.

### Understandable

Merchants should understand what will happen before execution.

### Fast

Normal UI operations should feel responsive.

### Scalable

Bulk operations must be processed asynchronously.

### Recoverable

Failures must be inspectable and retryable where appropriate.

---

# 47. MVP Definition of Done

The MVP is ready for launch when a real merchant can successfully complete:

```text
Install
 ↓
Connect
 ↓
Sync
 ↓
Select variants
 ↓
Create pricing rule
 ↓
Preview
 ↓
Approve
 ↓
Update Shopify
 ↓
View history
```

and additionally:

```text
Upload supplier CSV
 ↓
Match variants
 ↓
Detect cost changes
 ↓
Calculate new prices
 ↓
Preview
 ↓
Approve
 ↓
Update Shopify
```

without requiring developer intervention.

---

# 48. Explicit MVP Non-Goals

The following must not delay MVP launch:

* AI recommendations
* Machine learning
* Competitor scraping
* Dynamic demand pricing
* Advanced predictive analytics
* Multi-platform ecommerce
* Complex enterprise permissions
* Multiple supplier APIs
* Advanced reporting

Build them only after validating the core product with real merchants.

---

# 49. Product Success Criteria

The product should be considered successful if merchants repeatedly use it for pricing operations.

Important early signals:

* Installation
* Activation
* First successful pricing operation
* Repeat operations
* Supplier imports
* Scheduled operations
* Conversion to paid plan
* Merchant retention

The most important early metric is not the number of features.

It is:

> **How often merchants return to use PriceLogic to solve a real pricing problem.**

---

# 50. Final Product Principle

The MVP must solve one problem exceptionally well:

> **Give Shopify merchants a safe, repeatable, and automated way to manage product pricing at scale.**

Everything else is secondary.
