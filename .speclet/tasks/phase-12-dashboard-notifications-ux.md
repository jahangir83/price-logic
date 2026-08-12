# Phase 12: Dashboard, Notifications & UX States

Status: Not Started
Source: plans/04-user-flows.md #7,36,38; plans/06-product-requirements.md #40-41

## Tasks

- [ ] **Build the dashboard status overview** — After setup, the merchant lands on a dashboard that answers "what is happening?": show product/variant counts, active campaigns, and other high-level status. Keep the MVP dashboard focused — do not add sections beyond what the spec calls for.
- [ ] **Build the "pending issues" dashboard section** — Surface items needing merchant attention (e.g., failed pricing operations, campaigns in `RESTORE_CONFLICT`, failed imports) so the dashboard answers "what needs attention?".
- [ ] **Build the "recent activity" dashboard section** — Show recent pricing operations and recent price changes so the dashboard answers "what pricing work can I perform?" / gives visibility into what just happened.
- [ ] **Implement audit logging for key actions** — Record an auditable entry whenever one of these occurs: rule created, rule updated, operation approved, operation executed, campaign started, campaign ended, rollback executed. These entries back the dashboard's activity views and must be reliably written whenever the corresponding action succeeds.
- [ ] **Implement in-app notifications for completion/failure events** — Emit an in-app notification for: sync completed, operation completed, operation failed, campaign started, campaign completed, import completed. Email notifications are explicitly out of scope for MVP (may be added later).
- [ ] **Build the empty state for no pricing rules** — When a merchant has zero pricing rules, show "No pricing rules yet. Create your first rule to automate pricing." with a clear path into rule creation, per the Phase 5 flow.
- [ ] **Build the empty state for no pricing operations** — When a merchant has zero pricing operations, show "No pricing operations yet." Empty states must guide the merchant toward the next useful action, not just state absence.
- [ ] **Implement the unsaved-changes warning** — Detect when a merchant has modified an in-progress pricing configuration (rule, operation, or campaign form) and attempts to navigate away before saving/confirming; show a warning that prevents accidental loss where appropriate.
