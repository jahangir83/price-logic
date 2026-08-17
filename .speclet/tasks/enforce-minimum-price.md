# Enforce the minimum price

Status: Complete
Completed: 2026-08-16

The follow-up `optional-setup-guide.md` deliberately left open: making the
settings it seeded actually do something.

## What was wrong

`calculatePrice` has always taken a `minPrice`, clamped to it, marked the row
`FLOORED`, and stopped rounding pushing a floored price back up — all covered by
`calculate.spec.ts`. **Nothing ever passed one.** `input.minPrice ?? ZERO` meant
the floor was zero on every code path in the application.

So the protection was fully built and fully disconnected, which is the worst
shape for a guardrail to be in: it reads as present in the calculator, in the
settings screen and in the merchant's mental model, and is absent in fact.

## Tasks

- [x] **One merge rule.** `resolveStoreSettings()` in the shared package, used
  by the settings service and by every pricing path, so "what a missing minimum
  price means" is answered in one place rather than four.

- [x] **One piece of outcome copy.** `describeOutcome()` moved into shared
  beside `shouldApply`. The preview had a good local version; sheet activation
  had a hardcoded `'Already at this price.'` on *every* skipped row, which
  reported a floored variant as unchanged.

- [x] **Wire the floor into all three call sites** — preview (which catalog
  activation delegates to), sheet activation, and the import approval
  pre-fill.

- [x] **Tests on the wiring**, distinct from the arithmetic the calculator's own
  suite already covers.

- [x] **Correct the copy** on the settings screen and in the FAQ, both of which
  said the setting was not enforced.

## Decisions taken

**All three call sites or none.** The constitution's rule is that the merchant's
preview and the server's execution cannot disagree. Wiring the floor into the
preview alone would have shown merchants a protection that did not happen —
strictly worse than the honest absence it replaced.

**A floored variant is skipped, not sold at the floor.** Already how
`shouldApply` behaved, and it is worth restating: writing the floor produces a
price the merchant never chose, and leaves them no way to distinguish it from
one they did.

**The floor applies to an approved sheet price too.** A merchant approving a
supplier's list has agreed to those prices as an input, not waived the
protection they set against them.

**The default floor does not claim to be the merchant's.** At `0.01` the clamp
is a rounding guard rather than a choice, so the copy stays "the discount is
larger than the price". Only a floor raised above the default says "below your
minimum price" — telling someone they hit a limit they never set sends them
looking for a setting that is not there.

## Still not enforced

`minimumMarginPercent` and `maximumPrice`. Margin needs a cost price, which this
MVP does not model at all; the ceiling has no obvious skip-or-clamp answer and
no merchant has asked for one. The FAQ says so rather than implying otherwise.
