# Project Constitution

> Ground rules for this project. Injected into every speclet prompt once filled in.

## Code Quality
- ESLint + Prettier enforced across backend (NestJS) and frontend (React/Vite).
- TypeScript strict mode enabled — no `any` without explicit justification.

## Architecture Principles
- Backend organized as feature-based NestJS modules (pricing-engine, campaigns, suppliers, imports, etc.), each owning its own controller/service/entities — mirrors the phase breakdown in `tasks/`.
- No direct Shopify Admin API calls from controllers or React components — all Shopify access goes through a dedicated service/adapter layer, since it's the highest-risk external dependency (rate limits, auth, side effects).
- Schema changes ship only as version-controlled, reversible migrations — `synchronize` stays off in every environment.
- Some constraints can't be expressed with TypeORM entity decorators (notably the composite `(shop_id, parent_id) → parent(shop_id, id)` foreign keys that enforce tenant consistency). `migration:generate` diffs the DB against *entity metadata only*, so it will propose DROP statements for those constraints on every future run. Always read a generated migration before applying it and strip the spurious drop/recreate noise, keeping only the intended change.

## Domain Invariants
- **Pricing rule and campaign targeting is include + exclude, not a single scope.** A rule targets either *all products* or *specific targets*, and independently carries any number of exclusions. Both sides support targeting by product, collection, variant, tag, vendor, and product type. "All products except X" must be directly expressible. Exclusions always win over inclusions when a variant matches both.
- Campaigns reuse the pricing rule targeting model rather than defining their own.
- **Campaigns mutate product tags as a side effect, and must undo it exactly.** A campaign can add tags on activation (stripped on deactivation) and strip tags on activation (restored on deactivation). These "sale tags" are unrelated to tag *targeting*, which selects which products a rule hits.
- **Never reverse a side effect from configuration — reverse it from a record of what was actually done.** Every mutation the app makes to merchant data (tags today; the same reasoning already governs price history) is logged per affected entity, and undo replays that log. Inferring the undo from config silently destroys merchant data that happened to look like something the app set.

## Testing Requirements
- Jest for unit tests on all business logic, with full coverage required on the pricing engine specifically (flagged as the highest-risk, most-tested component in the task breakdown).
- Integration tests for API endpoints via NestJS's testing module against a real PostgreSQL test database.
- No mandated blanket coverage percentage — core money-calculation paths must be fully covered regardless.
- Schema/migration work is not done until the migration has actually been run (and reverted) against a real PostgreSQL instance and the app has booted against the resulting schema. If no database credentials are available, initialize a throwaway cluster with `initdb`/`pg_ctl` rather than skipping the check — build, lint, and mocked unit tests cannot catch bad constraint syntax, missing extensions, or DI wiring that only fails at real bootstrap.

## What To Avoid
- Never use JS floats for currency — decimal types only, end-to-end (DB, TypeORM entities, API payloads).
- Never trust client-supplied prices/costs for execution — always recalculate server-side before any mutation.
- Never start an `npm install` in a directory where another one is still running. Wait for the first to exit (check it, don't assume) — a concurrent install rewrites `package.json`/`package-lock.json` on completion and silently discards the other's additions.

## Definition of Done
A task is done when:
- Code is implemented per the task description.
- Relevant unit/integration tests are written and passing.
- ESLint/Prettier are clean.
- The task checkbox is marked `- [x]` in its phase file.
