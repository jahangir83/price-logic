---
name: speclet-implement
description: Implement all tasks in a single phase, marking each task done as you go.
user-invocable: true
allowed-tools:
  - read
  - write_file
  - edit
  - bash
  - grep
  - ask_user_question
---

# speclet implement

Work through every unchecked task in a single phase file, implementing each one in order and marking it `[x]` when complete.

## Instructions

The phase number or name to implement must be provided in the user's message (e.g., `1` or `Phase 2`).

1. **Load context**:
   - Read `.speclet/context.md` — project stack, conventions, and constraints
   - If `.speclet/constitution.md` exists and does **NOT** contain `<!-- speclet:unfilled -->`, read it — honour all quality rules, architecture principles, and Definition of Done
   - If `.speclet/constitution.learned.md` exists, read it — follow any rules in the `## Pending Rules` section
   - Read `.speclet/tasks/index.md` — the phase map

2. **Resolve the phase**:
   - Use the phase number or name from the user's message to identify the phase
   - If no phase was specified, ask the user which phase to implement and list available phases from the index
   - Find the task file path from the index (e.g., `.speclet/tasks/phase-1-setup.md`)
   - If the task file does not exist, stop and suggest running `/speclet-tasks` first

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
   - If any rules were appended to `.speclet/constitution.learned.md`, mention them and suggest running `/speclet-learn`

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
