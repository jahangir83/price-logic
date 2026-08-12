# Phase 7: Price History & Rollback

Status: Not Started
Source: plans/02-business.md #18-19; plans/03-domain-model.md #17-18,23; plans/04-user-flows.md #19-20; plans/06-product-requirements.md #28-29; plans/05-pricing-engine.md #46; plans/07-database.md #30-31

## Tasks

- [ ] **Define the append-only `price_history` record** — Persist one immutable record per successful price change with: `shop_id`, `variant_id`, `operation_id`, `previous_price`, `new_price`, `currency`, `source`, `changed_at`, plus the conceptual `reason` and pricing-rule reference the merchant sees when reviewing a change (db #30, business #18, domain-model #17). Done when the record can never be updated or deleted through normal application code — only inserted.

- [ ] **Define the price history `source` enum** — Require every price history record to carry one of `MANUAL`, `RULE`, `SUPPLIER_IMPORT`, `CAMPAIGN`, `SCHEDULE`, `AUTOMATION` (business #18). Done when no history record can be created without a valid source value.

- [ ] **Write a history record on every successful price change** — Hook into the bulk pricing execution completion (Phase 6) so that each variant whose price change status is `SUCCESS` produces exactly one price_history row; failed or skipped changes must not produce a history row (business #18, business #25 no silent data changes). Done when a completed operation's successful variants each have a matching history entry.

- [ ] **Preserve the full sequential timeline per variant** — Never overwrite or summarize prior history rows when a variant changes price again (e.g. `$100→$120` then later `$120→$135` must both remain queryable) (db #31). Done when a variant with multiple price changes shows every event in chronological order.

- [ ] **Build the Price History view** — List historical price changes (per variant and per shop) showing variant, previous price, new price, reason, operation reference, timestamp, and source, matching the merchant-facing example (`ABC-001, $100 → $130, Reason: 10% Price Increase, Operation: #OP-1024`) (user-flows #19, PR #28). Done when a merchant can open Price History and see a chronological, filterable list of past changes.

- [ ] **Determine rollback-eligible history entries** — Define which price_history records can be selected for rollback (e.g. a specific historical change for a variant) and surface a Rollback action from the Price History view only where technically/logically safe (business #19). Done when the UI only offers rollback on entries the system is prepared to process.

- [ ] **Implement rollback conflict detection** — Before generating a rollback preview, compare the current Shopify variant price to the price that the selected history event actually produced (`new_price`); if they differ, another operation has changed the price since, so return a Rollback Conflict instead of proceeding (user-flows #20, business #19, PR #29). Done when rolling back a variant that has since been changed by anything else surfaces a conflict rather than silently overwriting it.

- [ ] **Validate the restored price through the Pricing Engine before rollback preview** — Run the historical price through current validation (min price, min margin, and other active protections) rather than restoring it blindly; if the historical price would now violate a currently configured protection, block automatic restore and require explicit merchant review (pricing-engine #46). Done when a historical price that no longer satisfies today's protections cannot be silently reapplied.

- [ ] **Build the rollback preview and confirmation step** — Show the merchant the previous price, the current price, and the validation outcome, and require an explicit confirmation action before executing — generating or viewing the preview must never itself trigger the rollback (user-flows #20, PR #29). Done when no rollback can execute without a distinct confirm step.

- [ ] **Execute rollback as its own audited Pricing Operation** — Create a Pricing Operation with `operation_type = ROLLBACK` and `source = ROLLBACK`, reusing the bulk execution pipeline from Phase 6 (progress, per-variant success/failure) rather than performing a raw direct update. Done when a rollback produces a normal operation record and a new price_history row documenting the rollback itself.

- [ ] **Report rollback results using the standard operation result format** — Reuse Phase 6's success/failed/skipped result reporting for rollback operations rather than building a separate reporting path. Done when a rollback operation's outcome (success or failure, with reason) is visible to the merchant the same way any other pricing operation's result is.
