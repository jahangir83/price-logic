# Phase 1: Schema Re-baseline

Status: Complete (one task blocked — see below)
Completed: 2026-08-12
Source: plans/11-campaign-supplier-mvp.md — Phase 1
Branch: `mvp-schema-rebaseline` (not committed)

> Replaces the 17-table schema from `phase-02-database-schema-domain-model.md`.
> That phase stays on disk as history; its tables are dropped here.

## ⚠ Outstanding — needs the developer

**The "no production data" assumption could not be verified.** No database was
reachable from this machine: `postgres://…@127.0.0.1:5544/pricelogic_dev` refused
the connection and Docker needs sudo. All verification below ran against a
throwaway PostgreSQL 16 cluster created for the purpose, which was empty because
this session created it.

That says nothing about a database you or a deployed environment may hold. **Run
`SELECT count(*) FROM shops;` against every environment before applying this
migration anywhere real.** If any row exists, the migration drops 13 tables and
their contents.

## Assumptions taken

- **`audit_logs` is dropped.** Independent of everything else; reinstatable as a
  single additive migration. The decision is a task in MVP Phase 8 so it cannot
  be forgotten before launch.

## Tasks

- [ ] **Confirm the re-baseline assumption and choose the migration strategy** — **Strategy chosen and documented** in the migration header: drop-and-create on top of the existing history, not a squash, so migration history stays honest. `down()` returns the database to its post-Phase-1 shape (shops + session) rather than recreating the superseded 17-table schema, which would be dead code — this is the constitution's "reversible where practical" line. Every drop is `IF EXISTS`, so the migration is safe on a database that never had the old schema. **Left unchecked because the data-verification half could not be done** — see the warning above.

- [x] **Delete superseded modules and entities** — Removed `products`, `price-history`, `pricing-operations`, `pricing-rules`, `schedules` and `audit-logs` modules entirely, plus `supplier-record`, `import`/`import-record` and the two campaign tag entities. Every one contained only an entity and a `TypeOrmModule.forFeature` registration — no services, no controllers, no tests — confirming nothing was built on them. `shops`, `session`, `shopify-auth`, `store-init` and `webhooks` untouched. `app.module.ts` rewired to the three remaining feature modules.

- [x] **Write the `suppliers` entity** — Identity only: `name`, `code`, `status`, timestamps, `deleted_at`, plus `UNIQUE (shop_id, id)`. Soft-deleted because `csv_imports` references it.

- [x] **Write the `campaigns` entity** — All columns per the plan, with **no `campaign_type`**: `price_source` (SHOPIFY_CURRENT/SHEET) and the adjustment group (unit, direction, value) are independent, which is what lets a supplier sheet carry the merchant's own markup. Plus `basis`, `round_to`, `set_compare_at`, the include/exclude flags, `add_tags`/`remove_tags` arrays, and the schedule with IANA timezone columns.

- [x] **Write the `campaign_targets` entity** — Six target types **including `VARIANT`**, which the constitution mandates on both the include and exclude side and which the plan had wrongly dropped. `UNIQUE (campaign_id, mode, target_type, target_value)`, CASCADE from campaigns.

- [x] **Write the `price_changes` entity** — Shopify ids as plain varchars (nothing to reference — the catalog is not mirrored), cached titles, both old and new price *and* compare-at, and a `status` enum replacing the `isReverted`/`isProcess` booleans so FAILED is expressible. Surrogate uuid PK with `UNIQUE (campaign_id, shopify_variant_id)`.

- [x] **Write the `product_tag_changes` entity** — Whole `old_tags`/`new_tags` arrays rather than per-tag rows, replacing two tables from the old schema with one. Records what was actually done so revert replays it, per the constitution's undo rule.

- [x] **Write the `csv_imports` and `csv_rows` entities** — Staging for the approval form. `csv_rows` carries the three numbers that form shows side by side: `current_price`, `sheet_price`, `approved_price`. Added `UNIQUE (csv_import_id, row_number)` so re-parsing cannot duplicate rows, plus an `excluded` flag so a merchant can drop a row without deleting the record.

- [x] **Generate the migration and hand-edit it** — **Written by hand instead of generated.** `migration:generate` requires a live database to diff against and none was reachable; it also cannot see composite foreign keys or partial unique indexes and would emit spurious DROPs for them on every future run, exactly as the constitution warns. Hand-writing gave full control over a migration that drops 13 tables and creates 7. Reasoning recorded in the file header.

- [x] **Add the composite tenant foreign keys by raw SQL** — Every table gets `shop_id → shops(id) RESTRICT`; every child additionally gets `(shop_id, parent_id) → parent(shop_id, id)`. CASCADE only for `campaign_targets` and `csv_rows`, which are configuration and staging. Backed by `UNIQUE (shop_id, id)` on suppliers, campaigns and csv_imports.

- [x] **Add indexes for the real query paths** — `(shop_id, campaign_id)` on the three child tables, `(shop_id, status)` / `(shop_id, start_at)` / `(shop_id, end_at)` on campaigns for the scheduler's due-campaign scan, `(shop_id, created_at)` on csv_imports, `(csv_import_id, status)` on csv_rows. Nothing indexed speculatively.

- [x] **Run the migration up and down against a real PostgreSQL instance** — No database was reachable, so a throwaway PostgreSQL 16.14 cluster was created with `initdb`/`pg_ctl` exactly as the constitution prescribes. Verified: forward run applies all 6 migrations and yields the 8 target tables; `migration:revert` drops cleanly back to `shops` + `migrations`, leaving only the two shops enums; forward run again reproduces the schema. The NestJS app boots against the result — all modules initialise and routes map.

- [x] **Update the tenant-scoping layer to the new tables** — `TenantScopedRepository` is generic over `T extends { shopId: string }`, so it needed no change; all seven new entities satisfy it. Added `test/tenant-isolation.e2e-spec.ts` — 8 integration tests proving cross-tenant *writes* are rejected by the database. The cross-shop *read* test defers to MVP Phase 3, where there will be services to read through; there are no repositories or endpoints yet to exercise.

## Verification

Run against PostgreSQL 16.14 (throwaway cluster, `initdb`/`pg_ctl`):

| Check | Result |
| --- | --- |
| `tsc --noEmit` | pass |
| `eslint` (53 files) | 0 errors, 0 warnings |
| `nest build` | pass |
| Migration up → 8 tables + `migrations` | pass |
| `migration:revert` → `shops` + `migrations` | pass |
| Migration up again (reproducible) | pass |
| App boots against schema | pass — "Nest application successfully started" |
| Unit tests | 30 passed, 6 suites |
| Tenant-isolation integration tests | 8 passed |

Constraints proven by test, not just declared:

- a `price_change` in shop B **cannot** reference shop A's campaign — `FK_price_changes_campaign_shop`
- the same `(campaign, variant)` **cannot** be inserted twice — the activation retry guard
- a shop owning data **cannot** be deleted — RESTRICT
- a `SHEET` campaign **must** name its import — `CHK_campaigns_price_source`
- a half-specified adjustment is **rejected** — `CHK_campaigns_adjustment_group`
- a campaign ending before it starts is **rejected** — `CHK_campaigns_window`

### Environment note

`npm run` returns before its ts-node child finishes in this environment, which
produces misleading exit codes and stale reads immediately after
`migration:run`. Verify migration results by querying the database after a short
wait, not by trusting npm's exit status. Worth knowing before this goes in CI.

### Throwaway cluster

Still running on port 5544, matching `backend/.env`:

```
PGDATA=/tmp/claude-1000/-home-md-jahangir-alam-Desktop-redcircle-insaallah/\
e41c879a-6dc2-42b3-ab12-594666b559ff/scratchpad/pgdata
/usr/lib/postgresql/16/bin/pg_ctl -D "$PGDATA" stop     # stop
/usr/lib/postgresql/16/bin/pg_ctl -D "$PGDATA" \
  -o "-p 5544 -k /tmp -c listen_addresses=127.0.0.1" -l /tmp/pg.log start
```

It lives in a session scratchpad and will not survive a reboot. Point `.env` at
a real local instance when you have one.
