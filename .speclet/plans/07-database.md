# 07 - Database Design

> **SUPERSEDED — do not implement from this document.**
>
> This describes the 17-table schema that mirrored the Shopify catalog and
> modelled suppliers, costs, margins and pricing rules as separate concerns.
> The 2026-08-12 re-baseline replaced it, and its tables are dropped by
> `1786550000000-CampaignSupplierMvpRebaseline.ts`.
>
> **The schema as built is documented in `13-database-map.md`.** This file is
> kept as history — it records the reasoning that led to the redesign.

**Product:** PriceLogic
**Company:** We Solve X Tech
**Document Type:** Database Specification
**Status:** MVP
**Version:** 1.0

---

# 1. Purpose

This document defines the database structure required for the PriceLogic MVP.

The database must support:

* Multi-tenant Shopify stores
* Product synchronization
* Variant synchronization
* Pricing rules
* Pricing operations
* Price changes
* Price history
* Supplier data
* CSV imports
* Campaigns
* Scheduling
* Audit logging

---

# 2. Database Principles

The database must follow these principles:

1. Every merchant-owned record must have a tenant boundary.
2. Shopify IDs must be stored where external identity is required.
3. Internal IDs should be used for relationships.
4. Historical pricing data must be immutable.
5. Pricing operations must be auditable.
6. Financial values must use exact decimal types.
7. Duplicate Shopify records must be prevented.
8. Long-running operations must be represented by persistent state.
9. Soft deletion should be preferred where historical references matter.

---

# 3. Recommended Database

Preferred MVP database:

```text
PostgreSQL
```

Reasons:

* Strong relational model
* Excellent transactional support
* Reliable decimal/numeric types
* Good indexing
* JSON support where needed
* Suitable for multi-tenant SaaS

---

# 4. ID Strategy

Internal entities should use generated unique IDs.

Recommended:

```text
UUID
```

External Shopify IDs must be stored separately.

Example:

```text
id = internal UUID
shopify_product_id = Shopify identifier
```

Never use a Shopify ID as the primary key of an internal entity.

---

# 5. Money Representation

Money must never be stored as floating-point numbers.

Use:

```text
NUMERIC / DECIMAL
```

Example:

```text
price NUMERIC(19,4)
```

The exact precision can be adjusted according to application requirements.

---

# 6. Currency

Money-related records should have an explicit currency where required.

Example:

```text
currency = "USD"
```

Do not assume every future merchant uses USD.

---

# 7. Core Tables

MVP core tables:

```text
shops
products
variants
suppliers
supplier_records
pricing_rules
pricing_operations
price_changes
price_history
imports
import_records
campaigns
schedules
audit_logs
```

---

# 8. shops

Represents a Shopify store connected to PriceLogic.

Fields:

```text
shopify_shop_id
shop_domain
access_token / secure credential reference
currency
timezone
status
created_at
updated_at
```

Possible status:

```text
ACTIVE
DISCONNECTED
SUSPENDED
```

---

# 9. Shop Constraints

Required constraints:

```text
UNIQUE(shopify_shop_id)
UNIQUE(shop_domain)
```

A Shopify store must map to one PriceLogic Shop.

---

# 10. products

Represents a Shopify product.

Fields:

```text
shop_id
shopify_product_id
title
status
vendor
product_type
handle
created_at
updated_at
synced_at
```

Relationship:

```text
Shop
  ↓
Products
```

---

# 11. Product Constraints

Recommended:

```text
UNIQUE(shop_id, shopify_product_id)
```

This prevents the same Shopify product from being duplicated inside one shop.

---

# 12. variants

Represents the primary pricing unit.

Fields:

```text
shop_id
product_id
shopify_variant_id
sku
barcode
price
compare_at_price
currency
inventory_quantity
status
created_at
updated_at
synced_at
```

---

# 13. Variant Constraints

Required:

```text
UNIQUE(shop_id, shopify_variant_id)
```

SKU uniqueness should not be assumed globally.

If SKU uniqueness is required for matching, enforce it only according to the application's chosen policy.

---

# 14. Variant Indexes

Recommended indexes:

```text
(shop_id, sku)
(shop_id, product_id)
(shop_id, status)
(shop_id, shopify_variant_id)
```

These support product search and supplier matching.

---

# 15. suppliers

Represents a supplier.

Fields:

```text
shop_id
name
code
status
created_at
updated_at
```

Possible status:

```text
ACTIVE
INACTIVE
```

---

# 16. supplier_records

Represents supplier-provided product cost information.

Fields:

```text
shop_id
supplier_id
sku
external_product_id
cost
currency
available_quantity
source
source_reference
recorded_at
created_at
updated_at
```

The system should retain the source context where possible.

---

# 17. Supplier Record History

Supplier cost changes are important for pricing.

Avoid overwriting historical supplier data without a record.

The MVP may maintain current supplier data plus import history.

Future versions may introduce a dedicated:

```text
supplier_cost_history
```

table.

---

# 18. imports

Represents a supplier or external data import.

Fields:

```text
shop_id
supplier_id
file_name
file_type
status
total_rows
valid_rows
invalid_rows
matched_rows
unmatched_rows
created_at
completed_at
```

Possible status:

```text
PENDING
PROCESSING
COMPLETED
FAILED
CANCELLED
```

---

# 19. import_records

Represents an individual imported row.

Fields:

```text
import_id
shop_id
row_number
raw_data
sku
cost
currency
matched_variant_id
status
error_code
error_message
created_at
updated_at
```

`raw_data` may be stored as JSON/JSONB for debugging and audit purposes.

---

# 20. Import Record Status

Possible statuses:

```text
VALID
INVALID
MATCHED
UNMATCHED
APPLIED
SKIPPED
FAILED
```

---

# 21. pricing_rules

Represents reusable pricing logic.

Fields:

```text
shop_id
name
rule_type
value
currency
scope_type
scope_reference
minimum_price
maximum_price
minimum_margin
status
created_at
updated_at
```

---

# 22. Pricing Rule Types

MVP:

```text
PERCENTAGE_MARKUP
FIXED_MARKUP
TARGET_MARGIN
PERCENTAGE_INCREASE
PERCENTAGE_DECREASE
FIXED_INCREASE
FIXED_DECREASE
```

---

# 23. Pricing Rule Scope

Possible scope types:

```text
SHOP
COLLECTION
PRODUCT
VARIANT
```

For Shopify collections, the implementation may store a Shopify collection identifier.

---

# 24. Pricing Rule Value

The `value` field represents the rule-specific numeric value.

Examples:

```text
10%
25%
$20
30% margin
```

The application layer must interpret the value according to `rule_type`.

Do not rely on ambiguous database semantics.

---

# 25. pricing_operations

Represents an actual pricing execution request.

Fields:

```text
shop_id
name
operation_type
status
source
pricing_rule_id
scheduled_at
started_at
completed_at
total_variants
successful_variants
failed_variants
skipped_variants
created_by
created_at
updated_at
```

---

# 26. Operation Types

Examples:

```text
MANUAL_PRICE_CHANGE
RULE_EXECUTION
SUPPLIER_REPRICING
CAMPAIGN_START
CAMPAIGN_END
ROLLBACK
SCHEDULED_OPERATION
```

---

# 27. Operation Status

Recommended lifecycle:

```text
DRAFT
PREVIEW
APPROVED
QUEUED
PROCESSING
COMPLETED
FAILED
CANCELLED
```

The application must enforce valid state transitions.

---

# 28. price_changes

Represents the effect of a Pricing Operation on a specific variant.

Fields:

```text
shop_id
operation_id
variant_id
previous_price
proposed_price
final_price
previous_cost
current_cost
previous_margin
projected_margin
status
error_code
error_message
created_at
updated_at
```

---

# 29. Price Change Status

Possible statuses:

```text
PENDING
READY
SKIPPED
SUCCESS
FAILED
CONFLICT
```

---

# 30. price_history

Represents successful historical price changes.

Fields:

```text
shop_id
variant_id
operation_id
previous_price
new_price
currency
source
changed_at
```

Price history should be treated as append-only.

Do not update historical records to reflect current prices.

---

# 31. Price History Principle

If a variant changes:

```text
$100 → $120
```

then later:

```text
$120 → $135
```

history should contain both events:

```text
$100 → $120

$120 → $135
```

This creates an auditable timeline.

---

# 32. campaigns

Represents a temporary pricing campaign.

Fields:

```text
shop_id
name
status
pricing_rule_id
start_at
end_at
created_at
updated_at
```

Possible status:

```text
DRAFT
SCHEDULED
ACTIVE
COMPLETED
CANCELLED
FAILED
```

---

# 33. Campaign Targeting

A campaign needs a target definition.

MVP may reuse the pricing rule scope model.

Future versions may introduce a dedicated campaign target table if targeting becomes complex.

---

# 34. schedules

Represents scheduled execution.

Fields:

```text
shop_id
operation_id
scheduled_at
timezone
status
executed_at
created_at
updated_at
```

Possible status:

```text
SCHEDULED
PROCESSING
COMPLETED
FAILED
CANCELLED
```

---

# 35. audit_logs

Records important application actions.

Fields:

```text
shop_id
actor_type
actor_id
action
entity_type
entity_id
metadata
created_at
```

Example:

```text
action:
PRICING_OPERATION_APPROVED

entity_type:
PRICING_OPERATION

entity_id:
operation UUID
```

---

# 36. Audit Log Rules

Audit logs should be append-only.

Important events include:

```text
SHOP_CONNECTED
RULE_CREATED
RULE_UPDATED
RULE_DELETED
OPERATION_CREATED
OPERATION_APPROVED
OPERATION_STARTED
OPERATION_COMPLETED
OPERATION_FAILED
PRICE_UPDATED
ROLLBACK_EXECUTED
IMPORT_STARTED
IMPORT_COMPLETED
CAMPAIGN_STARTED
CAMPAIGN_COMPLETED
```

---

# 37. Relationships

Primary relationships:

```text
shops
 │
 ├── products
 │      └── variants
 │
 ├── suppliers
 │      └── supplier_records
 │
 ├── imports
 │      └── import_records
 │
 ├── pricing_rules
 │
 ├── pricing_operations
 │      └── price_changes
 │             └── variants
 │
 ├── price_history
 │
 ├── campaigns
 │
 ├── schedules
 │
 └── audit_logs
```

---

# 38. Foreign Key Principle

All tenant-owned relationships should enforce tenant consistency at the application/database design level.

Example:

```text
price_change.shop_id
price_change.variant_id
```

must never result in a PriceChange belonging to Shop A referencing a Variant belonging to Shop B.

---

# 39. Soft Deletion

Entities that may be referenced historically should generally use soft deletion.

Possible field:

```text
deleted_at
```

Candidates:

* Products
* Variants
* Pricing Rules
* Suppliers
* Campaigns

Historical records should remain accessible.

---

# 40. Timestamps

Most tables should contain:

```text
created_at
updated_at
```

Event/history tables may use:

```text
created_at
occurred_at
```

depending on semantic requirements.

---

# 41. Concurrency

Pricing operations must account for concurrent execution.

Example:

```text
Operation A:
$100 → $120

Operation B:
$100 → $130
```

Both should not blindly update the same variant.

The execution layer must use appropriate locking, version checking, or conflict detection.

---

# 42. Idempotency

Important operations must support idempotency.

A retry must not accidentally apply the same logical operation twice.

Recommended operation-level identifier:

```text
idempotency_key
```

where appropriate.

---

# 43. Shopify Synchronization

The database should distinguish between:

```text
Last known local state
```

and:

```text
Current Shopify state
```

The application should not assume local data is always current.

Before sensitive execution, current Shopify state may need to be revalidated.

---

# 44. Indexing Strategy

At minimum, index:

```text
shop_id
shopify_product_id
shopify_variant_id
sku
operation_id
variant_id
status
created_at
scheduled_at
```

Composite indexes should be created based on actual query patterns.

Avoid blindly indexing every column.

---

# 45. Data Retention

Pricing history and audit logs have long-term business value.

They should not be deleted simply because a product is removed from Shopify.

Retention policies should be defined separately from normal entity deletion.

---

# 46. Transaction Boundaries

The following operations should be transactionally coordinated where appropriate:

### Pricing Approval

```text
Approve Operation
+
Persist Approval State
```

### Operation Completion

```text
Persist Price Change Result
+
Persist Price History
+
Update Operation Status
```

The Shopify API itself is external and cannot be part of a normal database transaction.

Therefore external execution must be designed for partial failure and recovery.

---

# 47. Database vs Shopify Responsibility

Do not duplicate the entire Shopify database.

PriceLogic only needs the data required for:

* Pricing
* Matching
* Preview
* Execution
* History
* Analytics

Shopify remains the authoritative source for current storefront catalog data.

---

# 48. Future Tables

Possible future tables:

```text
ai_recommendations
competitor_prices
inventory_snapshots
sales_snapshots
supplier_integrations
pricing_experiments
subscriptions
billing_events
notifications
```

These should not be implemented unless required by the MVP.

---

# 49. Migration Principle

Database migrations must be:

* Version controlled
* Reproducible
* Reversible where practical
* Safe for production

Never manually modify production schema without a migration.

---

# 50. Final Database Principle

The database should make the following chain easy to trace:

```text
Shop
 ↓
Variant
 ↓
Pricing Rule
 ↓
Pricing Operation
 ↓
Price Change
 ↓
Shopify Update
 ↓
Price History
```

For supplier pricing:

```text
Supplier
 ↓
Import
 ↓
Import Record
 ↓
Variant Match
 ↓
Supplier Cost
 ↓
Pricing Operation
```

If a merchant asks:

> "Why is this product currently priced at this amount?"

the system should eventually be able to trace the answer through these records.
