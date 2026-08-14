# Phase 7: Deactivation, Revert & Scheduling

Status: Not Started
Source: plans/11-campaign-supplier-mvp.md — Phase 7

## Tasks

- [ ] **Build the revert service for prices** — Read every `APPLIED` row for the campaign and write `old_price` and `old_compare_at_price` back to Shopify in batches, then mark each row `REVERTED` with `reverted_at`. No joins, no history lookup, no recalculation — the row already carries everything. Restoring both columns is what makes "a product that was already on sale gets its previous sale price back" work.

- [ ] **Build the revert service for tags** — Read every `APPLIED` row in `product_tag_changes` and write `old_tags` back, then mark it `REVERTED`. Only rows we actually wrote exist, so a tag the merchant added themselves during the campaign is never stripped.

- [ ] **Handle prices changed by someone else during the campaign** — If the live Shopify price no longer equals our `new_price`, the merchant or another app edited it mid-campaign. Decide and implement: recommend skipping the revert for that row, marking it `SKIPPED` with a reason, and surfacing it in the results — blindly overwriting a deliberate manual change is worse than leaving it.

- [ ] **Build the scheduler** — A polling job that finds campaigns due to activate (`status = SCHEDULED AND start_at <= now()`) and due to deactivate (`status = ACTIVE AND end_at <= now()`), using the indexes from Phase 1. Must claim a campaign before working on it so two workers cannot activate the same one — a row lock or a status transition to a claimed state.

- [ ] **Handle missed windows after downtime** — If the app was down past a campaign's `start_at`, decide whether to activate late or skip. Recommend a grace period: activate late if within it, otherwise mark `FAILED` with a clear reason. A campaign whose `end_at` also passed while down must still deactivate, or prices stay discounted forever — that is the worst possible bug in this app.

- [ ] **Get the timezone handling right** — `start_at` is an instant, `start_timezone` is the merchant's intent. Compute the instant from the local time plus the IANA zone at save time, and re-verify across a DST boundary. Add unit tests for a campaign scheduled at 9am local across a spring-forward and a fall-back date.

- [ ] **Implement manual early deactivation** — A merchant ending a sale early runs the exact same revert path as the scheduled one, then moves the campaign to `COMPLETED`. No second code path — the difference is only what triggered it.

- [ ] **Make revert resumable** — A revert interrupted halfway must resume from the remaining `APPLIED` rows, and re-running a completed revert must be a no-op. Same guarantee as activation, same test.

- [ ] **Write integration tests for the full lifecycle** — Schedule → activate → verify prices and tags → deactivate → verify both restored exactly, including a product that was already on sale before the campaign, and a product whose price was manually edited mid-campaign.
