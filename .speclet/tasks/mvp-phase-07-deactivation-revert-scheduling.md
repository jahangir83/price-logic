# Phase 7: Deactivation, Revert & Scheduling

Status: Complete (unverified against a real store)
Completed: 2026-08-15
Source: plans/11-campaign-supplier-mvp.md — Phase 7

## Tasks

- [x] **Build the revert service for prices** — Read every `APPLIED` row for the campaign and write `old_price` and `old_compare_at_price` back to Shopify in batches, then mark each row `REVERTED` with `reverted_at`. No joins, no history lookup, no recalculation — the row already carries everything. Restoring both columns is what makes "a product that was already on sale gets its previous sale price back" work.

- [x] **Build the revert service for tags** — Read every `APPLIED` row in `product_tag_changes` and write `old_tags` back, then mark it `REVERTED`. Only rows we actually wrote exist, so a tag the merchant added themselves during the campaign is never stripped.

- [x] **Handle prices changed by someone else during the campaign** — If the live Shopify price no longer equals our `new_price`, the merchant or another app edited it mid-campaign. Decide and implement: recommend skipping the revert for that row, marking it `SKIPPED` with a reason, and surfacing it in the results — blindly overwriting a deliberate manual change is worse than leaving it.

- [x] **Build the scheduler** — A polling job that finds campaigns due to activate (`status = SCHEDULED AND start_at <= now()`) and due to deactivate (`status = ACTIVE AND end_at <= now()`), using the indexes from Phase 1. Must claim a campaign before working on it so two workers cannot activate the same one — a row lock or a status transition to a claimed state.

- [x] **Handle missed windows after downtime** — If the app was down past a campaign's `start_at`, decide whether to activate late or skip. Recommend a grace period: activate late if within it, otherwise mark `FAILED` with a clear reason. A campaign whose `end_at` also passed while down must still deactivate, or prices stay discounted forever — that is the worst possible bug in this app.

- [x] **Get the timezone handling right** — `start_at` is an instant, `start_timezone` is the merchant's intent. Compute the instant from the local time plus the IANA zone at save time, and re-verify across a DST boundary. Add unit tests for a campaign scheduled at 9am local across a spring-forward and a fall-back date.

- [x] **Implement manual early deactivation** — A merchant ending a sale early runs the exact same revert path as the scheduled one, then moves the campaign to `COMPLETED`. No second code path — the difference is only what triggered it.

- [x] **Make revert resumable** — A revert interrupted halfway must resume from the remaining `APPLIED` rows, and re-running a completed revert must be a no-op. Same guarantee as activation, same test.

- [x] **Write integration tests for the full lifecycle** — Schedule → activate → verify prices and tags → deactivate → verify both restored exactly, including a product that was already on sale before the campaign, and a product whose price was manually edited mid-campaign.

## Decisions taken

**A price somebody else changed is left alone.** If the live price no longer
equals what we last set, the merchant or another app edited it mid-campaign.
The row is SKIPPED with the actual value in the message. Overwriting a
deliberate manual change is worse than leaving a discount in place, and the
merchant can see exactly which products were skipped and why.

**The oldest applied row wins on revert.** A campaign activated twice without
a revert between — 100 → 80, then 80 → 64 — has a second row whose `old_price`
is 80, a price *this campaign* set. Restoring that would leave half its own
effect in place. The first row's 100 is the price the campaign found.

**Deactivation has no grace period. Activation does.** A campaign that missed
its start by more than an hour is FAILED rather than run late — starting a
Black Friday sale on the Monday after is worse than not starting it. A
campaign past its *end* is always reverted, however late, because prices
staying discounted while a worker was offline is the worst bug this app can
have: it costs the merchant money on every order, silently.

**Claiming is the dedup key, not a status.** Two schedulers finding the same
due campaign both enqueue; the partial unique index on `(shop_id, dedup_key)`
collapses them into one job and `campaign-exec` stops it overlapping. A CLAIMED
status would be a second mechanism doing the same work with its own way to get
stuck.

**A revert queues ahead of an activation** (priority 10), so a shop with both
pending puts prices back before it starts anything new.

## New migration

`1786900000000-SchedulerIndexes.ts` — three partial indexes. Every existing
`campaigns` index leads with `shop_id`, which suits a merchant browsing their
list but cannot answer "which campaigns *anywhere* are due?". The sweep was
planning as a sequential scan over the whole table every thirty seconds.

Verified at 20,000 campaigns: the planner picks `IDX_campaigns_due_start` with
no status filter, because the partial index already encodes it.

## Verification

| Check | Result |
| --- | --- |
| backend: `tsc --noEmit` / `nest build` | pass |
| backend: eslint (110 files) | 0 errors, 0 warnings |
| backend: unit tests | 216 passed, 14 suites |
| backend: integration tests | 158 passed, 8 suites (19 new) |
| shared: unit tests | 126 passed (24 new) |
| Migration up / revert / up | pass |

Timezone, against both 2026 DST boundaries:

- 9am New York is 14:00Z in winter and 13:00Z in summer — the same wall clock,
  an hour apart in UTC, which a stored instant alone would get wrong
- 9am on the spring-forward and fall-back days themselves
- Sydney, where the seasons invert
- 02:30 on a spring-forward morning is detected as **not existing**
- 01:30 on a fall-back morning is detected as **ambiguous**, and the earlier
  instant is taken
- every case round-trips

Lifecycle, against a Shopify stub that stores what it is told:

- activate then revert restores the exact price
- **a product already on sale gets its earlier sale price back** — 80/150 in,
  64/80 during, 80/150 out
- a price edited mid-campaign is skipped with the value in the message, and
  does not block the other variants
- a deleted variant is skipped
- tags restore to the exact prior set; a tag the merchant already had survives,
  because no row was ever written for it
- a second revert is a no-op
- two activations without a revert still restore to the original
- the scheduler starts what is due, ignores what is not, starts late inside the
  grace period, abandons what missed entirely, and **always** ends what is past
  its end
- two sweeps produce one job

## ⚠ Still unverified against Shopify

Revert uses the same two mutations as activation, which have never run against
a real store. The `2025-01` API version is still pinned.

## Notes for the next phase

- `RevertService` leaves a row APPLIED when Shopify rejects it, on purpose —
  the price is still ours, so the next attempt must try again rather than treat
  it as finished. That is why a partially failed revert leaves the campaign
  ACTIVE rather than COMPLETED.
- The scheduler is disabled by `SCHEDULER_ENABLED=false`, as the dispatcher is.
- Phase 8 owns the `audit_logs` decision and the webhook idempotency table.
