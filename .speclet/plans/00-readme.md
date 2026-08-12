# PriceLogic — Project Documentation

**Company:** We Solve X Tech
**Product:** PriceLogic
**Platform:** Shopify
**Status:** Pre-development / MVP Planning
**Document Version:** 1.0

---

## 1. What Is PriceLogic?

PriceLogic is a Shopify pricing automation platform designed to help merchants manage product prices efficiently and safely.

The product focuses on three primary outcomes:

1. Reduce manual pricing work.
2. Protect and improve merchant profit margins.
3. Make large-scale pricing operations simple and safe.

PriceLogic should not be treated as a simple bulk price editor.

The long-term goal is to become a pricing automation and intelligence platform for Shopify merchants.

---

## 2. Core Problem

Shopify merchants may manage hundreds, thousands, or more product variants.

Pricing becomes difficult when:

* Supplier costs change.
* Merchants need to increase or decrease prices in bulk.
* Different products require different pricing rules.
* Promotional campaigns need scheduled pricing.
* Temporary discounts need to be automatically reverted.
* Merchants need minimum-margin protection.
* Manual updates create mistakes and consume time.

PriceLogic exists to solve these problems.

---

## 3. Core Product Loop

The fundamental product loop is:

```text
Input
  ↓
Detect Changes
  ↓
Apply Pricing Rules
  ↓
Calculate Proposed Prices
  ↓
Validate
  ↓
Preview
  ↓
Merchant Approval
  ↓
Execute Update
  ↓
Record History
```

The system must never blindly change merchant prices when a workflow requires approval.

---

## 4. MVP Scope

The initial MVP focuses on:

### Shopify

* Shopify app installation
* Store authentication
* Product and variant synchronization
* Product/variant identification

### Pricing

* Bulk price increase
* Bulk price decrease
* Percentage-based pricing
* Fixed-amount pricing
* Margin-based pricing
* Minimum margin protection
* Price rounding rules
* Price preview

### Import

* Supplier CSV import
* Product matching using SKU/barcode/configurable identifiers
* Detection of changed supplier costs

### Operations

* Bulk update
* Update progress
* Update result
* Price history
* Basic rollback capability

### Automation

* Scheduled pricing changes
* Campaign start
* Campaign end
* Automatic restoration of previous prices

---

## 5. Explicitly Out of MVP

The following should NOT be implemented in the first MVP unless explicitly approved:

* AI pricing recommendations
* Competitor price scraping
* Dynamic pricing based on market demand
* Advanced predictive analytics
* Complex machine-learning models
* Multi-platform support
* Non-Shopify ecommerce integrations

These may become future features.

---

## 6. Product Philosophy

Every feature must provide measurable merchant value.

A feature should primarily:

* Save time
* Reduce operational effort
* Protect profit
* Increase profit
* Reduce errors
* Automate repetitive work

Feature quantity is not a product goal.

Merchant value is the product goal.

---

## 7. Safety Principle

Price changes are financially sensitive operations.

Therefore the system must prioritize:

* Preview before execution where appropriate
* Validation
* Audit history
* Idempotent jobs
* Safe retries
* Error handling
* Clear update status
* Rollback where technically possible

A failed update must not silently appear successful.

---

## 8. Source of Truth

The `/plans` directory is the source of truth for:

* Product requirements
* Business rules
* Domain concepts
* Pricing logic
* User flows
* Architecture decisions
* Technical constraints

Code must follow the documented business rules.

If implementation requirements conflict with documentation, the agent must stop and report the conflict instead of silently choosing a behavior.

---

## 9. Documentation Rules

Whenever a business rule changes:

1. Update the relevant documentation.
2. Explain the change.
3. Update affected tests.
4. Then update implementation.

Documentation and implementation must remain synchronized.

---

## 10. AI Agent Workflow

Before writing code, the code agent must:

1. Read all relevant files in `/plans`.
2. Identify the requested feature.
3. Identify affected business rules.
4. Identify affected domains/modules.
5. Explain the implementation plan.
6. Identify risks and edge cases.
7. Implement only after the plan is understood.
8. Run relevant tests.
9. Report what changed.

The agent must not rewrite unrelated code.

---

## 11. Development Principle

Prefer:

```text
Simple
→ Correct
→ Testable
→ Maintainable
→ Scalable
```

Do not optimize prematurely.

Do not introduce unnecessary infrastructure.

Do not create abstractions without a real reason.

---

## 12. Long-Term Product Direction

The product may eventually expand into:

* Supplier integrations
* Automated repricing
* Pricing campaigns
* Profit analytics
* Inventory-aware pricing
* Competitor pricing intelligence
* AI recommendations
* Dynamic pricing
* Advanced pricing analytics

These are future directions, not MVP requirements.

---

## 13. Success Criteria

The first objective is not maximum feature coverage.

The first objective is:

> Build a reliable pricing workflow that real Shopify merchants can use repeatedly.

The initial product should be small enough to launch quickly and strong enough to solve a real merchant problem.

---

## 14. Important Instruction to AI Agents

Do not assume that every requested feature belongs in the MVP.

If a request increases complexity without clear merchant value, raise the concern.

If a requirement is ambiguous, do not invent business behavior.

Ask for clarification or identify the ambiguity before implementing.

The goal is not to generate the maximum amount of code.

The goal is to build the correct product.
