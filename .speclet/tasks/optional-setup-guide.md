# Optional setup, settings page and setup guide

Status: Complete
Completed: 2026-08-15

Replaces the mandatory five-step setup wizard with the pattern Shopify itself
uses: defaults that exist from the moment the app is installed, a settings page
to change them, and a dismissible **setup guide** on the home screen that
suggests three things to do without requiring any of them.

Setup stops being a gate. A merchant who wants to build a campaign in the first
thirty seconds can.

## Shape of the guide

Three steps, from the design:

1. **Review your pricing defaults** — completed by opening Settings.
2. **Read the FAQ** — completed by opening the FAQ page.
3. **Create your first campaign** — completed by having one.

The first two are events and have to be recorded. The third is **derived from a
count**, never stored: a stored flag can disagree with the campaigns table, and
when it does the merchant is the one who has to work out which is lying.

## Tasks

- [x] **Shared: settings, defaults and onboarding shape.** `StoreSettings` (the
  four values the shop already stores, properly typed instead of a loose
  `Record<string, unknown>`), `DEFAULT_STORE_SETTINGS`, `ShopOnboarding`
  (`settingsVisitedAt` / `faqVisitedAt` / `dismissedAt`), and `SetupGuideDto`.
  Shared first, per the constitution — entity `implements` it afterwards.

- [x] **Migration: `shops.onboarding`.** A jsonb column defaulting to `{}`, run
  and reverted against the real database before the task counts as done.

- [x] **Seed defaults at install.** `upsertFromInstall` writes
  `DEFAULT_STORE_SETTINGS` for a new shop rather than `{}`. A reinstall keeps
  whatever the merchant had — their settings survive an uninstall, and
  overwriting them would be the app discarding a decision it was told to keep.

- [x] **Seed lazily on read.** `GET /settings` fills in any missing key from the
  defaults and persists it. This is what covers shops installed before this
  change, and it is why the guide can promise the settings screen is never
  empty.

- [x] **Setup guide API.** `GET /setup-guide` returns the three steps with
  their completion, computed per request; `POST /setup-guide/steps/:step/seen`
  records a visit idempotently; `POST /setup-guide/dismiss` hides it for good.

- [x] **Settings page.** The real editor for the four values, which the wizard's
  own copy already promised ("changed later from Settings") and which did not
  exist. Visiting it completes step one.

- [x] **FAQ page.** Static content, in the app rather than off-site so the step
  can complete without leaving Shopify. Visiting it completes step two.

- [x] **Home page with the setup guide.** Progress ring, collapsible card,
  per-step action buttons, strikethrough on done, dismissable — the design in
  the screenshot. Becomes `/`, so the app has a home that is not a list.

- [x] **Remove the gate and retire the wizard.** `RequireSetup` goes; `/setup`
  redirects home, because the OAuth callback still lands there. The wizard and
  its five step components are deleted rather than left unrouted.

- [x] **Tests.** Unit coverage on the seeding rules and on guide completion,
  including the reinstall case that must not overwrite merchant settings.

## Decisions taken

**Nothing consumes `defaultSettings` yet.** Confirmed by reading every
reference: it is written by the wizard, read back by the wizard, and touched by
nothing else — not the price calculator, not activation. Seeding it therefore
gives the merchant sensible values to *see and edit*, not protections that are
enforced. Enforcing them is a real change to money-affecting code and is not in
this phase; it is written down here so nobody later mistakes the presence of a
default for the presence of a guardrail.

**`initializationStatus` stops meaning "has the merchant finished the wizard"
and starts meaning "has this shop got its defaults".** There is no wizard to
finish any more, and a column that keeps a name from a flow that no longer
exists is how a schema becomes unreadable.
