# Phase 5: Pricing Rule Management

Status: Not Started
Source: plans/03-domain-model.md #11-13; plans/06-product-requirements.md #12; plans/04-user-flows.md #31-33; plans/05-pricing-engine.md #44

## Tasks

- [ ] **Define the PricingRule entity** — A rule must contain: name, type, value, scope, optional protection settings (minimum price, maximum price, minimum margin), and a status (`ACTIVE` / `INACTIVE`). A `PricingRule` defines *how* a price should be calculated, distinct from a Pricing Operation (Phase 6), which represents an actual request to execute pricing changes — the same rule may be reused by many operations.

- [ ] **Implement the MVP rule type set** — Support exactly: `PERCENTAGE_MARKUP`, `FIXED_MARKUP`, `TARGET_MARGIN`, `PERCENTAGE_PRICE_ADJUSTMENT`, `FIXED_PRICE_ADJUSTMENT`. Future types (`COMPETITOR_BASED`, `INVENTORY_BASED`, `DEMAND_BASED`, `AI_RECOMMENDED`) must not be assumed or partially implemented in the MVP.

- [ ] **Implement the rule scope model** — A scope is one of Global/Shop, Collection, Product, or Variant, with more-specific scopes taking priority (matching the Pricing Engine's Variant > Product > Collection > Shop resolution order from Phase 4). A rule persists both its definition (type + value) and its scope together as one unit (e.g. "Target Margin 30% @ Collection = Shoes", or "Markup 25% @ Variant = ABC-123").

- [ ] **Attach optional protection settings to a rule** — Allow a rule to optionally carry minimum price, maximum price, and minimum margin values that the Pricing Engine (Phase 4) reads and enforces when the rule is applied. Storing these values is this phase's responsibility; enforcing them is the engine's.

- [ ] **Build rule CRUD with ACTIVE/INACTIVE lifecycle** — Support create, read, update, and delete/deactivate for pricing rules, with an explicit status toggle between `ACTIVE` and `INACTIVE`. Only `ACTIVE` rules may participate in the engine's rule-priority resolution (Phase 4 §8).

- [ ] **Implement the rule creation flow** — Guide the merchant through: choose rule type → configure value → choose scope → configure protection settings → preview → save. Each step's output must be available to the next (e.g. the chosen type constrains which value fields are shown).

- [ ] **Implement the scope-selection step with affected-variant count** — Let the merchant pick Entire Store, Collection, Product, or Variant as the rule's scope, and clearly display how many variants will be affected by that scope choice before the rule is saved.

- [ ] **Implement rule preview before activation** — Before a new (or edited) rule is saved/activated, run it through the Pricing Engine (Phase 4) against sample/representative variant data (e.g. current price $100, cost $70, target margin 30% → calculated $100) so the merchant can see the effect of the rule before it goes live.

- [ ] **Implement pre-save rule validation** — Before a pricing rule can be saved as active, validate: markup percentage < 0 is invalid (per rule type), margin ≥ 100% is invalid under the standard margin formula, discount > 100% is invalid, and minimum price > maximum price is invalid. Validation failures must produce clear, actionable errors — never a silently-saved invalid rule.

- [ ] **Enforce validation at the save/activate boundary** — Wire the Phase 4 rule-validation checks into the actual save/activate code path (API and UI) so an invalid rule can never reach `ACTIVE` status or be persisted as usable by the engine. This is the same validation logic defined in the Pricing Engine spec (§44) — do not reimplement a second, divergent copy of it here.
