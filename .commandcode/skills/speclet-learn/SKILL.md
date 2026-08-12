---
name: speclet-learn
description: Review auto-captured rules from implementation sessions and merge them into the constitution.
---

# speclet learn

Review pending rules captured during implementation and decide which ones to permanently add to the project constitution.

## Instructions

1. **Check for pending rules**:
   - Read `.speclet/constitution.learned.md`
   - If no `### ` entries exist under `## Pending Rules`, report "No pending rules" and stop

2. **Load current constitution**:
   - Read `.speclet/constitution.md`

3. **Review rules one at a time**:
   - Present each pending rule to the developer
   - Ask: **Keep (merge into constitution), Skip (discard), or Defer (leave for later)?**
   - Wait for the answer before showing the next rule

4. **Apply decisions**:
   - **Keep**: Add the rule to the appropriate section of `.speclet/constitution.md`. Create a new section if needed.
   - **Skip**: Remove the rule entry from `.speclet/constitution.learned.md`.
   - **Defer**: Leave the rule unchanged in `.speclet/constitution.learned.md`.

5. **Write files**:
   - Rewrite `.speclet/constitution.md` with all kept rules merged in
   - Rewrite `.speclet/constitution.learned.md` with only deferred rules remaining
     (if none remain, keep the file with its header and empty `## Pending Rules` section)

6. **Report**: Confirm how many rules were merged, skipped, and deferred.
