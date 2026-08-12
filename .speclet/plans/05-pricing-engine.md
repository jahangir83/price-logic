# 05 - Pricing Engine

**Product:** PriceLogic
**Company:** We Solve X Tech
**Document Type:** Core Pricing Business Logic
**Status:** MVP Specification
**Version:** 2.0

**Document History:** Version 2.0 merges what were previously two separate, overlapping documents (`05-pricing-engine.md` v1.0 and a draft `08-pricing-engine.md`) into one canonical spec. Where the two drafts disagreed (the `PricingResult.status` enum, and how "rounding" was defined), this version states the resolved behavior explicitly — see §21 and §30.

---

# 1. Purpose

The Pricing Engine is the core decision-making component of PriceLogic.

Its responsibility is to answer:

> Given a variant, its current pricing data, a pricing strategy, and applicable protections, what should the new price be?

The Pricing Engine must be:

* Deterministic
* Predictable
* Testable
* Explainable
* Financially safe

The same input must always produce the same output.

---

# 2. Core Principle

The Pricing Engine must never modify Shopify directly.

It only calculates a **pricing result**.

```text
Input
  ↓
Pricing Engine
  ↓
Pricing Result
```

The execution layer is responsible for applying an approved result to Shopify.

This separation is mandatory.

---

# 3. Separation of Responsibilities

The Pricing Engine calculates prices. It does NOT:

* Call Shopify APIs
* Send emails
* Create UI responses
* Upload files
* Manage authentication
* Decide merchant permissions

```text
Pricing Engine
      ↓
Pricing Result
      ↓
Execution Service
      ↓
Shopify
```

---

# 4. Required Price Concepts

The system must distinguish the following concepts.

## Cost Price

The merchant's acquisition cost for the variant.

```text
cost = supplier cost
```

## Selling Price

The normal storefront price.

```text
sellingPrice = Shopify variant price
```

## Compare-at Price

The reference/original price shown by Shopify where applicable. This is separate from selling price.

PriceLogic must never assume compare-at price is the actual product cost.

## Campaign Price

A temporary price applied during a pricing campaign.

## Profit

```text
profit = sellingPrice - cost
```

This is gross product-level profit before other business expenses (shipping, payment processing, fees, taxes, advertising). Do not label it as net profit.

## Margin

Margin is calculated relative to selling price.

```text
margin = ((sellingPrice - cost) / sellingPrice) × 100
```

## Markup

Markup is calculated relative to cost.

```text
markupAmount = cost × markupPercentage
```

Markup and margin are different calculations and must never be treated as interchangeable. Example, both starting from `cost = $100`:

```text
30% Markup → Price = $130, Margin = 23.08%
30% Margin → Price = $142.86, Margin = 30%
```

The UI must clearly distinguish these concepts.

---

# 5. Pricing Input

The engine should receive a normalized input.

```text
PricingContext {
  variantId
  currentPrice
  currentCost
  currency
  pricingRule
  protections
  context (campaign, supplier, previous operation, rule source)
}
```

The exact implementation type is defined by the architecture.

---

# 6. Pricing Output

```text
PricingResult {
  variantId
  currentPrice
  proposedPrice
  finalPrice
  cost
  projectedProfit
  projectedMargin
  appliedRule
  status
  warnings
  errors
}
```

---

# 7. Price Calculation Pipeline

```text
1. Validate input
2. Load current price
3. Load cost
4. Resolve applicable rule
5. Calculate raw/base price
6. Apply minimum price
7. Apply maximum price
8. Validate minimum margin
9. Apply campaign adjustment (if active)
10. Apply rounding
11. Validate final price
12. Calculate profit/margin
13. Generate pricing result
```

The ordering must remain consistent. The exact technical implementation may differ, but business behavior must remain equivalent.

---

# 8. Rule Priority

When multiple rules apply to the same variant:

```text
Variant Rule
    ↓
Product Rule
    ↓
Collection Rule
    ↓
Shop / Global Rule
```

The most specific applicable rule wins:

```text
Variant > Product > Collection > Shop
```

Example:

```text
Global: +20%
Product: +30%
Variant: +40%

Variant receives: +40%
```

---

# 9. Rule Conflicts

MVP should avoid silently combining multiple competing rules at the same scope.

If two active rules have equal priority and conflict:

```text
status = RULE_CONFLICT
```

must be returned. The merchant must resolve the conflict — the engine must never randomly choose between conflicting rules.

---

# 10. Campaign Pricing

Campaign pricing must use the same Pricing Engine — do not create a separate calculator for campaigns.

```text
Campaign
 ↓
Pricing Rule
 ↓
Pricing Engine
 ↓
Pricing Result
```

Conceptually, campaign adjustment sits between normal rule calculation and final validation:

```text
Base Pricing
      ↓
Normal Pricing Rules
      ↓
Campaign Adjustment
      ↓
Validation
      ↓
Final Price
```

Example:

```text
Normal Price = $200
Discount = 15%

campaignPrice = 200 × (1 - 0.15) = $170
```

After calculating the campaign price, the system must validate minimum price, minimum margin, maximum discount, and any other configured protections. Campaign behavior must not destroy the merchant's normal pricing configuration.

---

# 11. Campaign Restoration

When a campaign ends, the system must restore the price that existed immediately before the campaign changed it, using the stored **snapshot** — not by reversing the pricing formula.

Restoration must be conflict-aware:

```text
Original = $200
Campaign = $170
Merchant later changes price = $190
Campaign ends
```

The system must not blindly restore `$200`. It must detect that the current price differs from the campaign-applied price and return:

```text
status = RESTORE_CONFLICT
```

The merchant decides what should happen next.

---

# 12. Percentage Price Change

## Increase

```text
newPrice = currentPrice × (1 + percentage / 100)
```

```text
Current = 100, Increase = 10% → Result = 110
```

## Decrease

```text
newPrice = currentPrice × (1 - percentage / 100)
```

```text
Current = 100, Decrease = 10% → Result = 90
```

The engine must reject a decrease that would result in an invalid price.

---

# 13. Fixed Price Change

## Increase

```text
newPrice = currentPrice + amount
```

```text
100 + 20 = 120
```

## Decrease

```text
newPrice = currentPrice - amount
```

```text
100 - 20 = 80
```

If the result is zero or negative: `status = INVALID_PRICE`, unless the configuration explicitly permits it.

---

# 14. Percentage Markup

```text
newPrice = cost × (1 + markup / 100)
```

```text
Cost = 100, Markup = 25% → Price = 125
```

---

# 15. Fixed Markup

```text
newPrice = cost + fixedMarkup
```

```text
Cost = 100, Fixed Markup = 30 → Price = 130
```

---

# 16. Target Margin

```text
sellingPrice = cost / (1 - targetMargin)
```

```text
Cost = 100, Target Margin = 30%

Price = 100 / (1 - 0.30) = 100 / 0.70 = 142.857...
```

After currency precision/rounding: `$142.86`.

---

# 17. Pricing Strategy

A merchant may configure a primary pricing strategy per rule:

```text
PERCENTAGE_MARKUP
FIXED_MARKUP
TARGET_MARGIN
CURRENT_PRICE_ADJUSTMENT   (percentage or fixed increase/decrease off current price)
```

---

# 18. Minimum Price Protection

```text
if calculatedPrice < minimumPrice:
    finalPrice = minimumPrice
    status includes MIN_PRICE_APPLIED
```

```text
Calculated = $80, Minimum = $100 → Final = $100
```

The minimum price must be applied before final validation.

---

# 19. Maximum Price Protection

```text
if calculatedPrice > maximumPrice:
    finalPrice = maximumPrice
    status includes MAX_PRICE_APPLIED
```

```text
Calculated = $200, Maximum = $180 → Final = $180
```

---

# 20. Minimum Margin Protection

```text
Cost = $100
Calculated Price = $120
Margin = 16.67%
Minimum Margin = 25%
```

The calculated price does not satisfy the requirement. The system must not silently pretend the result is valid.

There are two possible policies:

### Protect (MVP default)

Block/flag the price:

```text
Calculated price violates margin → status = MARGIN_VIOLATION
```

### Enforce

Automatically raise the price to satisfy the minimum margin:

```text
Calculated price → minimum margin calculation → higher safe price
```

**Resolution:** for MVP, the default behavior is **Protect**. The engine must not automatically change the merchant's intended price to satisfy a margin floor unless the rule explicitly configures Enforce behavior. This prevents unexpected prices and matches the project's "no silent data changes" principle.

A variant with no cost data cannot have its margin evaluated, so minimum margin protection cannot be checked — such a variant must be flagged `MISSING_COST`, never assumed safe.

---

# 21. Protection Conflict

Protections can conflict with each other:

```text
Minimum Price = $150
Maximum Price = $140
```

This configuration is invalid and must be rejected before pricing execution:

```text
status = INVALID_PROTECTION_CONFIGURATION
```

---

# 22. Protection and Validation Ordering

```text
Raw Calculation
 ↓
Minimum Price
 ↓
Maximum Price
 ↓
Minimum Margin Validation
 ↓
Campaign Adjustment (if any)
 ↓
Rounding
 ↓
Final Validation (re-check margin/price floor post-rounding)
```

Rounding is applied **after** protections are evaluated on the pre-rounded price, and the post-rounding price must be re-checked against the minimum margin floor and minimum price — rounding (e.g. charm pricing down to `.99`) can push a price back below a floor. A price must never leave the pipeline below its configured minimum margin or minimum price due to rounding. Any deliberate deviation from this order must be documented here.

---

# 23. Rounding

Rounding covers two distinct concerns, both centralized in the engine:

### a) Psychological / display rounding strategy (merchant-configurable)

```text
NO_ROUNDING
NEAREST_INTEGER
ROUND_UP_INTEGER
ROUND_DOWN_INTEGER
CHARM_99   (end in .99)
CHARM_95   (end in .95)
```

```text
$142.37 → $142.99
$87.42  → $87.99
```

Default: `NO_ROUNDING` (exact calculated value, resolved only to currency precision per §24).

### b) Decimal resolution mode (internal, not merchant-facing)

Whenever a calculation produces more precision than the currency supports (e.g. `100 / 0.70 = 142.857142...`) and no charm-pricing strategy is selected, the fractional remainder must be resolved using a single, centralized rounding mode:

```text
Default: ROUND_HALF_UP

Example: 10.125 → 10.13
```

The implementation must centralize rounding in one place rather than rounding ad hoc throughout the codebase.

---

# 24. Currency Precision

Pricing calculations must respect the store's currency precision. The engine must not hard-code two decimals for every currency — precision should be configurable according to supported currency rules. For MVP, the system may initially support the precision required by the Shopify stores it serves.

The system must avoid floating-point errors (e.g. `0.1 + 0.2` must not produce an incorrect financial value due to binary floating-point representation). The implementation must use a decimal/money-safe representation, never raw floating-point arithmetic, for financial calculations.

---

# 25. Price Validity

A final price must satisfy:

```text
price > 0
```

unless explicitly configured otherwise. The engine must reject and return `status = INVALID_PRICE` for:

* Negative price
* Zero price (not allowed by default — a free-product workflow, if ever supported, must be a separate explicitly-supported business behavior)
* NaN / Infinity
* Malformed decimal input

The engine must never send an invalid price to Shopify.

---

# 26. Missing Data

### Missing Cost

Required by markup, target margin, and minimum margin rules.

```text
status = MISSING_COST
```

The engine must not guess the cost.

### Missing Current Price

Required by percentage/fixed adjustments off the current price.

```text
status = MISSING_PRICE
```

### Missing Currency

```text
status = MISSING_CURRENCY
```

### Missing Rule

No applicable rule resolved for the variant.

```text
status = MISSING_RULE
```

---

# 27. Unchanged Price

```text
if finalPrice == currentPrice:
    status = UNCHANGED
```

No Shopify update is required.

---

# 28. Supplier Cost Repricing — Increase

```text
Old Cost = $100
New Cost = $120
Strategy: Target Margin = 30%

New Price = 120 / (1 - 0.30) = $171.43
```

The engine must use the merchant's configured pricing strategy, not simply add the same absolute amount as the supplier cost change, unless that is the merchant's configured rule.

---

# 29. Supplier Cost Repricing — Decrease

```text
Old Cost = $120
New Cost = $100
```

The merchant may have configured different strategies:

### Maintain Target Margin
Calculate a new (lower) price from the new cost.

### Preserve Current Price
Keep the current selling price unchanged.

### Automatically Reduce Price
Reduce the selling price according to a configured rule.

The system must never assume that a lower supplier cost automatically means the selling price should decrease — the merchant's selected strategy determines the behavior.

---

# 30. Supplier Cost Unchanged

```text
if oldCost == newCost:
    status = NO_COST_CHANGE
```

unless another active rule independently requires recalculation.

---

# 31. Rule Source

Every pricing result must identify the source of the calculation:

```text
MANUAL
PRICING_RULE
SUPPLIER
CAMPAIGN
SCHEDULE
ROLLBACK
```

Future: `AI_RECOMMENDATION`.

---

# 32. Explainability

Every calculated price must be explainable. Example:

```text
Current Price:   $150
Supplier Cost:   $110
Rule:            Target Margin 30%
Calculated:      $157.14
Rounded:         $157.99
```

For a plain increase:

```text
Current Price: $100
Rule: 10% Increase
Calculation: 100 × 1.10
Proposed Price: $110
```

The merchant must be able to understand why a price became what it became. Useful for preview UI, debugging, audit, and support. The system must never produce an unexplained pricing change.

---

# 33. Pricing Result Status (Canonical Enum)

This is the single canonical `status` enum for `PricingResult`. Any other document or implementation referring to pricing result statuses must use these values:

```text
READY
UNCHANGED
NO_COST_CHANGE
MIN_PRICE_APPLIED
MAX_PRICE_APPLIED
MARGIN_VIOLATION
MISSING_COST
MISSING_PRICE
MISSING_CURRENCY
MISSING_RULE
INVALID_PRICE
INVALID_PROTECTION_CONFIGURATION
RULE_CONFLICT
MATCHING_ERROR
CALCULATION_ERROR
RESTORE_CONFLICT
PRICE_CHANGED_SINCE_PREVIEW
```

---

# 34. Error Philosophy

Pricing errors must be explicit.

Bad: `price = 0` with no explanation.

Good:
```text
status = INVALID_PRICE
reason = "Calculated price is not greater than zero."
```

The system must prefer explainable failure over silent fallback.

---

# 35. Determinism

Given the same input, same rule, and same configuration, the result must be the same. Do not introduce random behavior.

---

# 36. No External Side Effects

The Pricing Engine must be a pure calculation layer. It must not update Shopify, write price history, send notifications, or modify merchant settings. The caller decides what to do with the result.

---

# 37. Bulk Pricing

```text
Variant 1 → Calculate
Variant 2 → Calculate
...
Variant N → Calculate
```

Each variant is processed independently. One invalid variant must not invalidate all other valid variants unless the operation has an explicitly configured all-or-nothing policy.

---

# 38. Partial Success

```text
Total: 1,000 variants
READY: 970
MISSING_COST: 5
MARGIN_VIOLATION: 15
INVALID_PRICE: 10
```

The operation must report these categories separately; the preview must make them visible; the merchant must be able to identify affected variants.

---

# 39. Approval Policy

MVP default: only `READY` results are eligible for automatic inclusion in execution.

Results marked `MISSING_COST`, `INVALID_PRICE`, `RULE_CONFLICT`, or `INVALID_PROTECTION_CONFIGURATION` must not be executed.

Results marked `MIN_PRICE_APPLIED` or `MAX_PRICE_APPLIED` may be executed if the merchant explicitly approves them — they represent a protection being applied, not an error.

---

# 40. Idempotency

The same pricing operation must not accidentally apply the same change multiple times.

```text
Intended (single run):  100 → 110
Wrong (double-applied): 100 → 110 → 121
```

The operation must have an identifiable execution context and safe retry behavior.

---

# 41. Conflict Detection and Stale Preview

Before execution, the system must verify that input state has not changed unexpectedly since preview:

```text
Preview: Current Price = $100
Before execution: Shopify Price = $120
```

```text
status = PRICE_CHANGED_SINCE_PREVIEW
```

If significant pricing inputs change after preview (current price, cost, rule, protection config), the preview is stale and the operation must require recalculation before it can proceed.

---

# 42. Auditability

The engine must provide enough information to answer: *why did this variant receive this price?* At minimum:

```text
Variant
Old Price
Cost
Applied Rule
Calculated Price
Final Price
Operation
Timestamp
```

---

# 43. Edge Cases

The engine must account for:

* Missing cost / current price / currency
* Invalid, negative, or zero cost
* Negative or zero calculated price
* Extremely large price
* Invalid percentage
* Margin ≥ 100%
* Duplicate or conflicting rules
* Missing matching variant
* Currency precision differences
* Campaign overlap
* Concurrent pricing operations
* Manual Shopify price changes between preview and execution
* Failed Shopify updates

---

# 44. Rule Validation

Before a pricing rule is saved, it must be validated:

```text
Markup percentage < 0            → invalid (depending on rule type)
Margin >= 100%                   → invalid (standard margin formula)
Discount > 100%                  → invalid
Minimum Price > Maximum Price    → invalid
```

Invalid rules must never become active.

---

# 45. Concurrent Operations

Two pricing operations may target the same variant:

```text
Operation A: Campaign discount
Operation B: Supplier repricing
```

The system must detect concurrent operations and apply the documented conflict policy. It must never silently overwrite one operation's result with another's.

---

# 46. Rollback Pricing

Rollback must not bypass validation.

```text
Historical Price
 ↓
Current State Validation
 ↓
Rollback Preview
 ↓
Pricing Engine / Validation
 ↓
Execution
```

If the historical price is no longer safe to restore (e.g. it would now violate a currently-configured minimum margin), require merchant review rather than restoring blindly.

---

# 47. Rule Extensibility

The engine should use a strategy-based architecture so that adding a future rule type does not require rewriting the engine:

```text
PricingRule
   ↓
RuleStrategy
   ├── PercentageIncrease
   ├── PercentageDecrease
   ├── FixedIncrease
   ├── FixedDecrease
   ├── PercentageMarkup
   ├── FixedMarkup
   └── TargetMargin
```

---

# 48. Future AI / Intelligence Layer

The Pricing Engine should eventually expose structured data (price history, campaign history, margin, cost) to an intelligence layer that may suggest actions such as "increase price by 5%."

AI must produce a recommendation, not bypass the Pricing Engine:

```text
Correct:
AI → Recommended Price → Validation → Pricing Engine → Preview → Merchant Approval → Execution

Incorrect:
AI → Direct Shopify Update
```

AI recommendations must never directly change merchant prices without an explicit merchant-approved workflow.

---

# 49. Testing Requirements

Every pricing strategy must have unit tests covering:

* **Normal cases** — valid price and cost
* **Boundary cases** — zero, very small, very large values
* **Protection cases** — minimum/maximum price
* **Margin cases** — exactly at threshold, below, above
* **Missing data** — missing cost, price, currency
* **Rounding** — values requiring rounding
* **Conflicts** — changed price after preview
* **Bulk** — mixed valid and invalid variants

## Example Test Cases

```text
Percentage Increase:      100, +10%        → 110
Percentage Decrease:      100, -10%        → 90
Markup:                   cost 100, +25%   → 125
Target Margin:            cost 100, 30%    → 142.86
Minimum Price:             calc 80, min 100 → 100
Minimum Margin Violation: cost 100, price 110, min margin 20% → MARGIN_VIOLATION
```

---

# 50. Acceptance Criteria

The Pricing Engine is complete when:

* All MVP pricing strategies are implemented.
* Calculations use decimal arithmetic (never binary floating-point).
* Rounding is centralized (§23).
* Protections (min/max price, min margin) work consistently and in the documented order (§22).
* Missing data is handled explicitly, never guessed.
* Rule conflicts are detected, never silently resolved.
* Results are deterministic.
* Shopify is never called directly by the engine.
* Unit test coverage covers all major calculation paths (§49).
* Every result is explainable (§32).

---

# 51. Golden Rule

The Pricing Engine must be boring. It must be predictable, mathematically correct, testable, and it must never surprise the merchant.

```text
AI / Merchant Input
        ↓
Pricing Engine
        ↓
Explainable Result
        ↓
Merchant Approval
        ↓
Shopify Execution
```

AI can recommend. The Pricing Engine decides according to explicit rules. The Merchant approves. The Execution System updates Shopify. This separation is fundamental to PriceLogic.
