# Phase 6: Bulk Pricing Operation Workflow (Preview → Approve → Execute)

Status: Not Started
Source: plans/02-business.md #14-17,24-25; plans/04-user-flows.md #8-18,37,40,43; plans/06-product-requirements.md #21-27,43

## Tasks

- [ ] **Implement target selection for a pricing operation** — Let the merchant select pricing targets via individual products, individual variants, product collections, filters, search, or "select all matching," and clearly display how many products/variants are affected (e.g. "42 products / 128 variants") before proceeding.

- [ ] **Implement pricing-method configuration step** — Offer the MVP pricing methods (increase by %, decrease by %, increase by fixed amount, decrease by fixed amount, markup, target margin) and explain the difference between markup and margin inline where relevant, so the merchant can't confuse the two.

- [ ] **Implement pricing-value input with immediate validation** — Validate the entered value (e.g. "10%") as soon as it's entered and reject invalid input (negative, >100% where nonsensical, non-numeric, empty) with clear, merchant-facing validation feedback before preview generation is allowed.

- [ ] **Implement the PricingOperation lifecycle state machine** — Model the operation lifecycle as DRAFT → PREVIEW → APPROVED → QUEUED → PROCESSING → COMPLETED, with FAILED and CANCELLED as possible terminal states. The operation record tracks target variants, pricing configuration, calculation result, approval state, execution state, and final result.

- [ ] **Implement preview generation by calling the Pricing Engine** — On "Generate Preview," pass the configured operation (targets + rule/method) to the Pricing Engine (Phase 4) — or to a saved Pricing Rule via Phase 5 for rule-based operations — for every selected variant, and collect the resulting `PricingResult`s. Preview generation must never modify Shopify or write any persisted price change.

- [ ] **Build the preview screen with full per-row detail** — Display, per variant: Variant/SKU, current price, new price, change, cost, profit, margin, applied rule, and status, using the canonical status values produced by the engine (e.g. `ABC-001 $100 → $130, 23.08% margin`).

- [ ] **Implement preview status categorization and filtering** — Group and let the merchant filter preview rows by outcome category (Ready, Unchanged, Margin Warning/Violation, Invalid, Missing Cost, Unmatched, etc.), mapped from the Pricing Engine's canonical `PricingResult.status` enum (Phase 4), so the merchant can quickly find rows needing attention even in large batches.

- [ ] **Implement dangerous-operation confirmation for large-scope changes** — For operations affecting a large number of variants, summarize scope before allowing approval (e.g. "You are about to change 2,430 variants — 2,100 increases, 330 decreases") and require the merchant to explicitly confirm.

- [ ] **Implement the explicit approval gate** — Approval must be a distinct, deliberate merchant action. Generating a preview, navigating pages, or creating/editing a pricing rule must never be interpreted as approval — Shopify is updated only after this explicit step.

- [ ] **Implement the async execution job** — On approval: create an execution job, process variants, revalidate that preview inputs haven't drifted since preview (recalculate/flag via the engine's stale-preview check rather than blindly executing stale data), call the execution layer to update Shopify, retry transient Shopify failures, and record a per-variant result. Execution must avoid applying the same change twice on retry (idempotent by operation/execution context).

- [ ] **Implement execution progress reporting** — For long-running bulk operations, expose pollable/retrievable progress (e.g. "1,240 / 2,000 variants") that reflects actual processing state, without requiring the merchant to keep the browser open continuously.

- [ ] **Implement the completion summary** — After execution finishes, show Total / Successful / Failed / Skipped / Unchanged counts for the operation.

- [ ] **Implement the failure inspection view** — For each failed record, show the variant, attempted price, failure reason (in merchant-understandable language, not raw error codes), current Shopify state, and a recommended action (e.g. Retry).

- [ ] **Enforce the no-silent-data-change guarantee across the workflow** — Every automated price change produced by this workflow must carry a reason, a source, a reference to the originating rule/operation, a timestamp, and a resulting history record (Phase 7) — no price may change without all five being recorded.

- [ ] **Apply the universal workflow pattern as the structural contract** — Build this operation type strictly as INPUT → VALIDATE → CALCULATE → PREVIEW → APPROVE → EXECUTE → VERIFY → RECORD, preferring this over any shortcut that lets configuration changes reach Shopify directly — this ordering is the standard for every financially-sensitive workflow in the product, not just this one.
