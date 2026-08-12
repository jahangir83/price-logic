# 04 - User Flows

**Product:** PriceLogic
**Company:** We Solve X Tech
**Document Type:** User Flow Specification
**Status:** MVP Specification
**Version:** 1.0

---

# 1. Purpose

This document defines the primary user journeys in PriceLogic.

The goal is to make every important merchant workflow predictable, simple, and safe.

The UI/UX implementation should be derived from these flows.

---

# 2. Core User Journey

The primary merchant journey is:

```text
Install
  ↓
Connect Store
  ↓
Sync Products
  ↓
Configure Pricing
  ↓
Select Operation
  ↓
Preview
  ↓
Approve
  ↓
Execute
  ↓
Review Result
  ↓
Monitor History
```

---

# 3. First-Time Merchant Journey

A new merchant should experience the following:

```text
Shopify App Installation
        ↓
Authentication
        ↓
Initial Store Setup
        ↓
Product Synchronization
        ↓
Pricing Configuration
        ↓
First Pricing Operation
```

The first experience should avoid overwhelming the merchant with advanced features.

---

# 4. App Installation

The merchant installs PriceLogic from Shopify.

After installation:

```text
Shopify
   ↓
PriceLogic
   ↓
Store Authentication
```

The application should verify the Shopify store context before continuing.

---

# 5. Initial Setup

After authentication, the merchant enters the setup flow.

The setup should collect only information required to begin using the MVP.

Potential setup steps:

```text
Step 1:
Store connected

Step 2:
Product synchronization

Step 3:
Default pricing strategy

Step 4:
Minimum margin / price protection

Step 5:
Finish setup
```

The merchant should be able to change these settings later.

---

# 6. Product Synchronization

PriceLogic must obtain the product and variant information required for pricing.

Conceptual flow:

```text
Start Sync
    ↓
Fetch Shopify Products
    ↓
Fetch Variants
    ↓
Store / Update Local Representation
    ↓
Sync Complete
```

The UI should show:

* Sync status
* Number of products
* Number of variants
* Errors if any

---

# 7. Dashboard Journey

After setup, the merchant enters the dashboard.

The dashboard should answer:

1. What is happening?
2. What needs attention?
3. What pricing work can I perform?

Potential dashboard information:

```text
Products
Variants
Recent Pricing Operations
Active Campaigns
Pending Issues
Recent Price Changes
```

The MVP dashboard should remain focused.

---

# 8. Create a Simple Price Change

The simplest pricing workflow is a direct bulk price change.

Example:

> Increase selected products by 10%.

Flow:

```text
Pricing
  ↓
Create Price Change
  ↓
Select Products
  ↓
Choose Increase
  ↓
Enter 10%
  ↓
Preview
  ↓
Review
  ↓
Approve
  ↓
Execute
```

---

# 9. Product Selection

The merchant should be able to select pricing targets.

Possible selection methods:

* Individual products
* Individual variants
* Product collections
* Filters
* Search
* Select all matching products

The system must clearly communicate how many variants will be affected.

Example:

```text
42 products
128 variants
```

---

# 10. Pricing Method Selection

The merchant selects the pricing method.

MVP options:

```text
Increase by %
Decrease by %
Increase by fixed amount
Decrease by fixed amount
Markup
Target margin
```

The UI should explain the difference between markup and margin when necessary.

---

# 11. Enter Pricing Value

Example:

```text
Increase by:
10%
```

The system should validate the input immediately.

Invalid examples:

```text
-10%
150%
abc
empty
```

The merchant should receive clear validation feedback.

---

# 12. Generate Preview

After the merchant configures the pricing operation:

```text
Generate Preview
```

The system calculates proposed prices without changing Shopify.

Flow:

```text
Configuration
      ↓
Pricing Engine
      ↓
Preview Result
```

---

# 13. Preview Screen

The preview should clearly show:

```text
Variant
Current Price
New Price
Change
Cost
Margin
Rule
Status
```

Example:

```text
SKU       Current    New      Margin

ABC-001   $100       $130     23.08%
ABC-002   $150       $195     23.08%
ABC-003   $200       $260     23.08%
```

---

# 14. Preview Statuses

Each row may have a status.

Examples:

```text
READY
UNCHANGED
MARGIN WARNING
INVALID
MISSING COST
UNMATCHED
```

The merchant should be able to filter the preview by status.

---

# 15. Approval

The merchant reviews the preview.

If everything is acceptable:

```text
Approve Changes
```

Approval should be explicit.

The system must not treat simply opening or generating a preview as approval.

---

# 16. Execution

After approval:

```text
Approved
   ↓
Create Execution Job
   ↓
Process Variants
   ↓
Update Shopify
   ↓
Record Results
```

The UI should show progress.

Example:

```text
Updating prices...

350 / 1,000 variants
```

---

# 17. Completion

After execution, show a clear summary.

Example:

```text
Completed

Successful: 970
Skipped: 10
Failed: 20
```

The merchant should be able to inspect failures.

---

# 18. Failure Inspection

For failed records, the merchant should see:

```text
Variant
Attempted Price
Reason
Current Shopify State
Recommended Action
```

Example:

```text
SKU: ABC-123

Could not update.

Reason:
Shopify rejected the price update.

Action:
Retry
```

Errors should be understandable to a merchant.

---

# 19. Price History Flow

Merchant navigates to:

```text
Price History
```

They can view previous changes.

Example:

```text
ABC-001

$100 → $130

Reason:
10% Price Increase

Date:
2026-08-07

Operation:
#OP-1024
```

---

# 20. Rollback Flow

Where rollback is supported:

```text
Price History
     ↓
Select Change
     ↓
Review Previous Price
     ↓
Rollback
     ↓
Confirm
     ↓
Execute
```

Before rollback, the system should check whether the current Shopify price still matches the price created by the original operation.

If not:

```text
Rollback Conflict
```

should be shown.

---

# 21. Supplier CSV Import Flow

Supplier pricing is an important workflow.

```text
Supplier Data
     ↓
Upload CSV
     ↓
Detect Columns
     ↓
Map Columns
     ↓
Validate Data
     ↓
Match Shopify Variants
     ↓
Preview Changes
     ↓
Calculate New Prices
     ↓
Merchant Approval
     ↓
Update Shopify
```

---

# 22. CSV Upload

Merchant uploads a supplier CSV.

Example:

```text
SKU,Cost
ABC-001,100
ABC-002,120
ABC-003,95
```

The system must validate:

* File type
* Required columns
* Numeric cost
* Currency where applicable
* Duplicate identifiers
* Empty values

---

# 23. Column Mapping

Different suppliers may use different column names.

Example:

```text
Supplier column:
Product Code

PriceLogic field:
SKU
```

The merchant should be able to map supplier columns to PriceLogic fields.

---

# 24. Import Validation

Before pricing calculation:

```text
CSV
 ↓
Parse
 ↓
Validate
```

Invalid records should be separated.

Example:

```text
Total rows: 1,000

Valid: 950
Invalid: 20
Unmatched: 30
```

---

# 25. Supplier Matching

Valid supplier rows are matched to Shopify variants.

Primary matching:

```text
Supplier SKU
      ↓
Shopify SKU
```

If no match exists:

```text
UNMATCHED
```

No unmatched record should update a Shopify variant.

---

# 26. Supplier Cost Change Preview

After matching:

```text
Old Cost
New Cost
Cost Change %
Current Price
Proposed Price
Margin
```

Example:

```text
SKU:
ABC-001

Old Cost:
$100

New Cost:
$120

Current Price:
$150

Proposed Price:
$171.43
```

---

# 27. Supplier Approval

Supplier data must not automatically change Shopify prices simply because a CSV was uploaded.

The merchant must review the resulting pricing changes.

Flow:

```text
Import
 ↓
Calculate
 ↓
Preview
 ↓
Approve
 ↓
Execute
```

---

# 28. Campaign Creation Flow

Merchant creates a campaign.

```text
Campaigns
   ↓
Create Campaign
   ↓
Campaign Name
   ↓
Select Products
   ↓
Select Discount / Pricing Rule
   ↓
Set Start Time
   ↓
Set End Time
   ↓
Preview
   ↓
Schedule
```

---

# 29. Campaign Activation

At the scheduled start time:

```text
Scheduled
   ↓
Start
   ↓
Calculate Prices
   ↓
Validate
   ↓
Execute
   ↓
Active
```

The campaign should produce an operation that can be audited.

---

# 30. Campaign Completion

At the scheduled end time:

```text
Active
   ↓
End
   ↓
Check Restoration Conditions
   ↓
Restore Eligible Prices
   ↓
Complete
```

If a conflict is detected:

```text
RESTORE_CONFLICT
```

The merchant must be informed.

---

# 31. Pricing Rule Creation Flow

Merchant creates a reusable pricing rule.

```text
Pricing Rules
    ↓
Create Rule
    ↓
Choose Rule Type
    ↓
Configure Value
    ↓
Choose Scope
    ↓
Configure Protection
    ↓
Preview
    ↓
Save
```

---

# 32. Rule Scope Selection

Merchant may select:

```text
Entire Store
Collection
Product
Variant
```

The UI must clearly show the number of variants affected.

---

# 33. Rule Preview

Before activating a new rule, the system should allow a preview.

Example:

```text
Current Price: $100
Cost: $70
Target Margin: 30%

Calculated:
$100
```

The merchant should understand the effect before enabling the rule.

---

# 34. Scheduled Pricing Flow

For a scheduled operation:

```text
Create Operation
   ↓
Configure Pricing
   ↓
Choose Date/Time
   ↓
Preview
   ↓
Schedule
```

At execution time:

```text
Scheduled
   ↓
Validate
   ↓
Calculate
   ↓
Execute
```

If important conditions have changed between scheduling and execution, the system should revalidate before applying changes.

---

# 35. Revalidation

Example:

```text
Merchant schedules:
Target Margin = 30%

At scheduling:
Cost = $100

At execution:
Cost = $130
```

The system should not blindly use the old calculation.

It should recalculate using the latest valid data according to the operation's policy.

---

# 36. Empty State

When a merchant has no pricing rules:

```text
No pricing rules yet.

Create your first rule to automate pricing.
```

When there are no operations:

```text
No pricing operations yet.
```

Empty states should guide the merchant toward the next useful action.

---

# 37. Dangerous Operation Confirmation

Operations affecting many variants should clearly communicate scope.

Example:

```text
You are about to change:

2,430 variants

Estimated price increases:
2,100

Estimated price decreases:
330
```

The merchant should explicitly confirm when appropriate.

---

# 38. Unsaved Changes

If the merchant modifies a pricing configuration but leaves the page, the system should prevent accidental loss where appropriate.

The UI should warn about unsaved changes.

---

# 39. User Experience Principle

The merchant should always understand:

```text
What am I doing?
        ↓
What will change?
        ↓
Why will it change?
        ↓
What happens next?
```

The UI should never force the merchant to understand technical implementation details.

---

# 40. Core UX Rule

The application should prefer:

```text
Configure
→ Preview
→ Approve
→ Execute
→ Verify
```

over:

```text
Configure
→ Immediately change Shopify
```

This is especially important for bulk and automated pricing.

---

# 41. First Value Moment

The first-time merchant should reach a meaningful result quickly.

The ideal first value moment is:

```text
Connect Store
   ↓
Select Products
   ↓
Create Simple Pricing Rule
   ↓
Preview
   ↓
Apply
   ↓
See Successful Result
```

The merchant should understand the value of PriceLogic after this workflow.

---

# 42. Future AI Recommendation Flow

Not part of MVP.

Future:

```text
Analytics
   ↓
AI Analysis
   ↓
Recommendation
   ↓
Merchant Review
   ↓
Accept / Reject
   ↓
Pricing Operation
   ↓
Preview
   ↓
Execute
```

AI should explain the recommendation.

Example:

```text
Recommended price increase: 5%

Reason:
Strong sales velocity and healthy demand.
```

The merchant remains in control.

---

# 43. Universal Workflow Pattern

All major PriceLogic workflows should follow this general pattern:

```text
INPUT
  ↓
VALIDATE
  ↓
CALCULATE
  ↓
PREVIEW
  ↓
APPROVE
  ↓
EXECUTE
  ↓
VERIFY
  ↓
RECORD
```

This is the standard workflow pattern for financially sensitive operations.

---

# 44. Final User Flow Principle

PriceLogic should make complex pricing operations feel simple.

The merchant should think:

> "I tell PriceLogic what I want, I review what will happen, and PriceLogic safely handles the work."

That is the desired user experience.
