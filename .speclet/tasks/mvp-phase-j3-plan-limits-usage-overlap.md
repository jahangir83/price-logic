# Phase J3: Plan Limits, Usage & Overlap Resolution

Status: Complete
Completed: 2026-08-14
Source: plans/12-jobs-billing.md — Phase J3
Depends on: J1 (schema), J2 (engine) — both Complete

> Task list derived from the plan's Phase J3 section; there was no task file,
> so it was written here rather than blocking on `/speclet-tasks`.

This is where the pure rules written in J1 finally get called. The arithmetic
already has unit coverage in `@pricelogic/shared`; what this phase adds is the
SQL that feeds it, which is why the tests here are integration tests.

## Tasks

- [x] **Resolve a shop's effective plan limits** — the active subscription, or
  Free when there is none, with the shop's nullable override columns taking
  precedence. A frozen subscription inside its grace period keeps its
  entitlements; one outside it does not.

- [x] **Count what is actually on sale** — distinct variants across *applied*
  changes belonging to *active* campaigns. Shop-wide and deduplicated, so a
  variant claimed by two campaigns counts once.

- [x] **Check the quota for an activation** — compute what the shop-wide total
  would become if this campaign proceeded, in one query, excluding the
  campaign's own previous rows so a re-activation is not double-counted.

- [x] **Fail activation permanently on a quota breach** — raise the engine's
  `PermanentJobError` with `PLAN_LIMIT_EXCEEDED` and the limit/current/required
  numbers, so it is never retried and the UI can render an upgrade prompt.

- [x] **Maintain and reconcile the usage counters** — `store_usage` feeds the
  meter in the admin UI; it is refreshed after every activation and revert, and
  a reconcile pass recomputes it from scratch.

- [x] **Resolve overlapping claims on apply** — when several active campaigns
  want the same variant, pick the winner by the shop's policy (with the
  campaign's override) and mark the losers SKIPPED rather than silently
  dropping them.

- [x] **Resolve overlapping claims on revert** — do not blindly restore
  `old_price`. If another active campaign still holds the variant, recompute
  from the survivors; only restore the original when nothing else claims it.

- [x] **Tests** — integration tests against real PostgreSQL for every query
  above, including the two-campaigns-one-variant case on both sides.

## Verification

PostgreSQL 16.14 (throwaway cluster).

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (72 files) | 0 errors, 0 warnings |
| backend: unit tests | 37 passed, 7 suites |
| backend: integration tests | 96 passed, 5 suites (30 new) |
| shared: unit tests | 82 passed, 4 suites |

Behaviour proven rather than asserted:

- a shop with no subscription is on **Free**, never unlimited
- a **cancelled** subscription drops to Free; a **frozen** one keeps its
  entitlements inside the grace period and loses them outside it
- a shop override beats the plan's own limit
- only **APPLIED** changes on **ACTIVE** campaigns count as on sale — PENDING
  and REVERTED rows do not
- a variant claimed by two campaigns counts **once**
- two 30-variant campaigns are rejected on a 50-variant plan even though
  neither exceeds it alone
- a campaign's own rows are excluded from its own quota check, so
  re-activating a live campaign does not lock the merchant out of it
- the required total is the **deduplicated union**: 30 shared + 25 new = 55
- a breach raises `PermanentJobError`, which the engine never retries, and
  carries limit / current / required for the upgrade prompt
- on apply, a contested variant goes to the bigger discount; the loser is
  returned as skipped **with a reason**, not silently dropped
- a per-campaign `SKIP` override beats the shop default and touches nothing
- a rival whose change was never applied holds nothing and does not displace
- **on revert, a variant another live campaign still owns keeps that
  campaign's price** rather than being restored to full price

## Notes for the next phase

- Nothing calls these services yet. MVP Phase 6 registers the
  `CAMPAIGN_ACTIVATE` handler that runs `enforceActivationQuota` at the
  `CHECK_PLAN_LIMIT` step and `resolveForActivation` before writing changes;
  Phase 7 uses `resolveForRevert`.
- `resolveForActivation` takes the proposed changes as an argument rather than
  computing them — target resolution is MVP Phase 2/4 work and does not exist
  yet.
- `activatedAt` for the LATEST policy currently reads `campaigns.start_at`.
  That is the scheduled instant, not the moment activation actually ran; if
  LATEST is ever made the default, it should key on the activation job's
  `finished_at` instead.
