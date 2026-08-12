---
description: Implement all tasks in a single phase, marking each task done as you go.
handoffs:
  - label: Implement Next Phase
    agent: speclet.implement
    prompt: Implement the next phase
  - label: Review Learned Rules
    agent: speclet.learn
    prompt: Review and merge the rules captured during implementation
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).
`$ARGUMENTS` should contain the phase number or name to implement (e.g., `1` or `Phase 2`).

## Goal

Work through every unchecked task in a single phase file, implementing each one in order and marking it `[x]` when complete.

## Outline

1. **Load context**:
   - Read `.speclet/context.md` — project stack, conventions, and constraints
   - If `.speclet/constitution.md` exists and does **NOT** contain `<!-- speclet:unfilled -->`, read it — honour all quality rules, architecture principles, and Definition of Done
   - If `.speclet/constitution.learned.md` exists, read it — follow any rules in the `## Pending Rules` section
   - Read `.speclet/tasks/index.md` — the phase map

2. **Resolve the phase**:
   - Use `$ARGUMENTS` to identify the phase by number or name
   - If `$ARGUMENTS` is empty, ask the user which phase to implement and list available phases from the index
   - Find the task file path from the index (e.g., `.speclet/tasks/phase-1-setup.md`)
   - If the task file does not exist, stop and suggest running `/speclet.tasks` first

3. **Load the phase file**:
   - Read **ONLY** the requested phase task file — do not load any other phase files
   - Count and list the unchecked tasks (`- [ ]`)

4. **Implement tasks in order**:
   - Work through each unchecked task `- [ ]` sequentially
   - Implement the task following the stack in `.speclet/context.md` exactly
   - If a task is ambiguous, add a brief inline code comment and note the ambiguity — do not guess
   - Mark each task done immediately after completing it: change `- [ ]` to `- [x]`
   - Report progress after each task

5. **On completion**:
   - Verify all tasks in the phase are marked `[x]`
   - Update the phase file header with:
     ```
     Status: Complete
     Completed: <today's date>
     ```
   - Summarize what was built: files created, endpoints added, key decisions made
   - If any rules were appended to `.speclet/constitution.learned.md`, mention them and offer the "Review Learned Rules" handoff

## Rules

- Follow the stack and conventions in `.speclet/context.md` exactly
- Honour all rules from `.speclet/constitution.md` (quality, architecture, DoD)
- Do **NOT** load or modify other phase files
- Halt and ask for guidance if a non-ambiguous blocker is encountered

## Capturing Learned Rules

If you correct a bash command, discover a project pattern, or notice something that should always be done:
→ Append it to `.speclet/constitution.learned.md` under `## Pending Rules`:

```
### [YYYY-MM-DD] category: short-title
**Rule:** What to always do.
**Why:** What went wrong or why this matters.
```

Categories: `bash`, `pattern`, `architecture`, `testing`, `tooling`
