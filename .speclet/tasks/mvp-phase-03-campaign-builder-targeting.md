# Phase 3: Campaign Builder & Targeting

Status: Complete
Completed: 2026-08-14
Source: plans/11-campaign-supplier-mvp.md — Phase 3

## Tasks

- [x] **Build the campaigns NestJS module** — Controller, service and DTOs for create, read, update, soft-delete and list. Feature-based module per the constitution, tenant-scoped on every query. List supports filtering by status and ordering by `start_at`.

- [x] **Validate the adjustment field group** — `adjustment_unit`, `adjustment_direction` and `adjustment_value` are all-or-nothing: either all three are set or all three are null. Reject a percentage decrease of more than 100%, a negative value, and a zero value. Enforce in a DTO validator, not in the controller body.

- [x] **Validate the schedule** — `end_at` must be after `start_at`; both timezones must be valid IANA zone names; `start_at` may not be in the past on create. A campaign with no `end_at` never auto-reverts, so decide and document whether that is allowed — recommend requiring it for MVP, matching the reference app.

- [x] **Validate the price source group** — `price_source = SHEET` requires `csv_import_id` and forbids include/exclude targets (the file's SKU list is the target). `price_source = SHOPIFY_CURRENT` requires `csv_import_id` to be null. Reject anything else with a clear message.

- [x] **Implement the campaign status state machine** — Legal transitions only: `DRAFT → SCHEDULED → ACTIVE → COMPLETED`, with `FAILED` and `CANCELLED` reachable from any non-terminal state. Editing is allowed in `DRAFT` and `SCHEDULED` only. Put the transition table in one place so Phases 6 and 7 call it rather than setting `status` directly.

- [x] **Build the campaign_targets service** — Add, remove and list targets for a campaign. Enforce the unique constraint gracefully (adding an existing target is a no-op, not a 500). Support all six target types including `VARIANT`, per the constitution.

- [x] **Implement target resolution rules as a documented function signature** — Define, but do not yet implement, how include/exclude resolve: `ALL_PRODUCTS` starts from the whole catalog, `SPECIFIC` starts from the INCLUDE rows, `exclusions_enabled` gates the EXCLUDE rows, `exclude_draft_archived` applies independently, and **exclusions always win**. Phase 4 implements it; this task fixes the contract so both phases agree.

- [x] **Build the campaign form UI** — React + Polaris, embedded via App Bridge: title, price source, adjustment (unit, direction, value), basis, rounding, compare-at toggle, add/remove tags, start and end with timezone selectors. Mirror the reference app's layout, including the live summary panel.

- [x] **Wire the include/exclude pickers into the form** — All-products vs specific radio, three include pickers, the two exclude checkboxes, three exclude pickers, and a running count of selected targets. Reuses the Phase 2 picker components.

- [x] **Write unit tests for every validator and the state machine** — Table-driven tests covering each rejection case above and each legal and illegal status transition. These are cheap and prevent an invalid campaign ever reaching the activation code.

## Decision taken: `end_at` stays optional

This phase's own brief recommended requiring an end date. **I did not**, and the
reasoning is worth recording because it is a reversal.

The app's campaign types include a permanent repricing — "increase everything
5%" — which has no end date by definition. Requiring one would make the
merchant invent a date and then be surprised when their prices reverted on it.
The brief also claimed requiring it matched the reference app; it does not —
that schema's `endDate` is nullable while `startDate` is not.

So: `end_at` optional, and a campaign without one never auto-reverts and must
be deactivated by hand. The form says exactly that ("Leave empty and it runs
until you stop it") and the summary panel repeats it.

`start_at` is optional too: absent means "start it myself", not invalid. It
becomes required only on the transition to SCHEDULED, which the service
enforces.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (90 files) | 0 errors, 0 warnings |
| backend: unit tests | 153 passed, 11 suites (69 new) |
| backend: integration tests | 96 passed, 5 suites |
| frontend: eslint / `tsc -b` / `vite build` | 0 errors · pass · pass |
| shared: unit tests | 82 passed |

Rules proven by test rather than asserted:

- a half-specified adjustment is rejected in all four shapes
- zero is rejected rather than treated as "no adjustment" — a merchant who
  typed 0 meant something
- a percentage decrease over 100% is rejected; exactly 100% is allowed
- a fixed amount larger than any price is allowed — the calculator's floor
  handles it
- an absurd percentage increase is caught as the typo it is
- four real IANA zones accepted, four plausible non-zones rejected
- an end before *or equal to* the start is rejected
- a past start is rejected on create and allowed on edit, with a minute of
  slack for the form's own latency
- a sheet campaign must name its import and cannot also carry targets
- all 13 legal status transitions, and 9 illegal ones
- a terminal status can reach nothing; CANCELLED is reachable from everything
  non-terminal
- editing is refused outside DRAFT and SCHEDULED, including in FAILED

## Notes for the next phase

- **`target-resolution.ts` is a contract, not an implementation.** It throws
  rather than returning an empty set, because an empty result reads as
  "nothing matched" and a campaign that silently prices nothing is the worst
  possible stand-in. Phase 4 implements it.
- **The form saves as DRAFT only.** Activation is Phase 6; a merchant filling
  in a form has not yet decided to change every price in their store.
- The summary panel's worked example calls `calculatePrice` — the same
  function the server runs at activation. That is the whole reason it lives in
  the shared package.
- `CampaignsService.replaceTargets` exists for the form's save path but the
  form currently sends targets inline on create. Editing an existing
  campaign's targets needs the PATCH path wired.
