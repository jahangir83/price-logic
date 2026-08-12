# Phase 9: Supplier-Driven Repricing

Status: Not Started
Source: plans/02-business.md #10; plans/04-user-flows.md #26-27; plans/05-pricing-engine.md #28-30; plans/06-product-requirements.md #34-35

## Tasks

- [ ] **Classify supplier cost changes** — For each accepted `supplier_records` entry produced by an import (Phase 8), compare the new cost to the previously stored cost for that variant and classify as `UNCHANGED`, `INCREASED`, `DECREASED`, or `NEW` (business #10, PR #34). Done when every matched, accepted supplier record from an import carries one of these four classifications.

- [ ] **Skip recalculation for unchanged costs** — When classified `UNCHANGED`, mark the pricing result `NO_COST_CHANGE` and skip repricing for that variant — no Shopify update, no pricing operation entry — unless another currently active rule independently requires recalculation (business #10, pricing-engine #30). Done when re-importing the same costs produces no proposed price changes.

- [ ] **Implement configurable cost-decrease repricing policy** — Let the merchant choose, per shop or per rule, how a `DECREASED` supplier cost is handled: Maintain Target Margin (recalculate a lower price from the new cost), Preserve Current Price (leave the selling price unchanged), or Automatically Reduce Price (apply a configured rule) — never assume a lower cost should automatically lower the selling price without explicit configuration (pricing-engine #29). Done when switching the configured policy visibly changes the proposed price for the same cost decrease.

- [ ] **Feed increased/new costs into the Pricing Engine using the merchant's configured strategy** — For `INCREASED` and `NEW` classifications, invoke the Pricing Engine (Phase 4) with the merchant's configured pricing rule (target margin, markup, etc.) to compute the proposed price, rather than simply adding the raw cost delta to the current price unless that is explicitly how the rule is configured (pricing-engine #28). Done when a cost increase run through a Target Margin rule reproduces the documented example (`cost $100→$120, target margin 30% → $171.43`).

- [ ] **Apply the decrease policy through the Pricing Engine for decreased costs** — For `DECREASED` classifications, invoke the Pricing Engine using the shop's configured decrease policy (from the prior task) to produce the correct pricing result for each of the three policy options. Done when each decrease policy produces a pricing result consistent with its definition, using the same engine as every other pricing path.

- [ ] **Create a Supplier Repricing Pricing Operation from accepted import data** — Build a Pricing Operation with `operation_type = SUPPLIER_REPRICING` and `source = SUPPLIER`, containing one price-change candidate per matched, cost-changed supplier record, reusing the Pricing Operation model and lifecycle from Phase 6 rather than a parallel workflow. Done when a processed import with cost changes results in exactly one operation ready for preview.

- [ ] **Build the Supplier Cost Change Preview** — For each affected variant, show old cost, new cost, cost-change %, current price, proposed price, and projected margin, matching the documented example (`ABC-001: old cost $100, new cost $120, current price $150, proposed price $171.43`), by extending Phase 6's bulk pricing preview with these supplier-specific columns rather than building a new preview UI (user-flows #26). Done when a merchant can review every supplier-driven price change before approval.

- [ ] **Require explicit merchant approval before any Shopify update** — Ensure uploading or processing a CSV never itself changes Shopify prices; a Shopify update can only happen after the merchant explicitly approves the Supplier Cost Change Preview, reusing Phase 6's approval gate (user-flows #27, business "supplier data is not always truth"). Done when no supplier-driven price change reaches Shopify without a distinct, logged approval action.

- [ ] **Execute approved supplier repricing through the existing bulk execution pipeline** — Reuse Phase 6's execution flow (progress reporting, per-variant success/failure, retries) for supplier repricing operations instead of building a separate execution path. Done when a supplier repricing operation's execution behaves identically to a manual bulk pricing operation's execution.

- [ ] **Record price history for every executed supplier price change** — Ensure each successfully executed supplier-driven price change writes a Phase 7 `price_history` record with `source = SUPPLIER_IMPORT`, referencing the triggering import and operation, so the merchant can trace a price back to the supplier cost update that caused it. Done when the Price History view for a repriced variant shows the supplier import as the reason for the change.
