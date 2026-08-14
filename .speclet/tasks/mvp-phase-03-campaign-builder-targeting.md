# Phase 3: Campaign Builder & Targeting

Status: Not Started
Source: plans/11-campaign-supplier-mvp.md — Phase 3

## Tasks

- [ ] **Build the campaigns NestJS module** — Controller, service and DTOs for create, read, update, soft-delete and list. Feature-based module per the constitution, tenant-scoped on every query. List supports filtering by status and ordering by `start_at`.

- [ ] **Validate the adjustment field group** — `adjustment_unit`, `adjustment_direction` and `adjustment_value` are all-or-nothing: either all three are set or all three are null. Reject a percentage decrease of more than 100%, a negative value, and a zero value. Enforce in a DTO validator, not in the controller body.

- [ ] **Validate the schedule** — `end_at` must be after `start_at`; both timezones must be valid IANA zone names; `start_at` may not be in the past on create. A campaign with no `end_at` never auto-reverts, so decide and document whether that is allowed — recommend requiring it for MVP, matching the reference app.

- [ ] **Validate the price source group** — `price_source = SHEET` requires `csv_import_id` and forbids include/exclude targets (the file's SKU list is the target). `price_source = SHOPIFY_CURRENT` requires `csv_import_id` to be null. Reject anything else with a clear message.

- [ ] **Implement the campaign status state machine** — Legal transitions only: `DRAFT → SCHEDULED → ACTIVE → COMPLETED`, with `FAILED` and `CANCELLED` reachable from any non-terminal state. Editing is allowed in `DRAFT` and `SCHEDULED` only. Put the transition table in one place so Phases 6 and 7 call it rather than setting `status` directly.

- [ ] **Build the campaign_targets service** — Add, remove and list targets for a campaign. Enforce the unique constraint gracefully (adding an existing target is a no-op, not a 500). Support all six target types including `VARIANT`, per the constitution.

- [ ] **Implement target resolution rules as a documented function signature** — Define, but do not yet implement, how include/exclude resolve: `ALL_PRODUCTS` starts from the whole catalog, `SPECIFIC` starts from the INCLUDE rows, `exclusions_enabled` gates the EXCLUDE rows, `exclude_draft_archived` applies independently, and **exclusions always win**. Phase 4 implements it; this task fixes the contract so both phases agree.

- [ ] **Build the campaign form UI** — React + Polaris, embedded via App Bridge: title, price source, adjustment (unit, direction, value), basis, rounding, compare-at toggle, add/remove tags, start and end with timezone selectors. Mirror the reference app's layout, including the live summary panel.

- [ ] **Wire the include/exclude pickers into the form** — All-products vs specific radio, three include pickers, the two exclude checkboxes, three exclude pickers, and a running count of selected targets. Reuses the Phase 2 picker components.

- [ ] **Write unit tests for every validator and the state machine** — Table-driven tests covering each rejection case above and each legal and illegal status transition. These are cheap and prevent an invalid campaign ever reaching the activation code.
