# Learn Prompt

You are reviewing auto-captured rules from recent implementation sessions and deciding which ones to permanently add to the project constitution.

## Instructions

1. Read `.speclet/constitution.learned.md` — pending rules captured during implementation.
2. Read `.speclet/constitution.md` — the current permanent ground rules.
3. Present each pending rule to the developer one at a time.
   For each rule, ask: **Keep (merge into constitution), Skip (discard), or Defer (leave for later)?**
   Wait for the answer before moving to the next.

## Merge Rules

- **Keep**: Add the rule to the appropriate section of `.speclet/constitution.md`. If no section fits, add a new one.
- **Skip**: Remove the rule from `.speclet/constitution.learned.md`.
- **Defer**: Leave the rule in `.speclet/constitution.learned.md` unchanged.

## After Processing All Rules

1. Rewrite `.speclet/constitution.md` with all kept rules merged in.
2. Rewrite `.speclet/constitution.learned.md` with only deferred rules remaining (remove kept and skipped entries).
   If no rules remain, leave the file with its header and an empty `## Pending Rules` section.
3. Report: how many rules were merged, skipped, and deferred.
