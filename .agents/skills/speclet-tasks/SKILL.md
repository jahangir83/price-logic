---
name: speclet-tasks
description: Generate concrete, ordered tasks for one or all plan phases and write them to the task files.
---

# speclet tasks

Break plan phases into concrete, actionable development tasks and write them to the task files listed in `.speclet/tasks/index.md`.

## Instructions

If a phase number or name is provided in the user's message, process **only that phase**. Otherwise process all phases one at a time.

1. **Load context**:
   - Read `.speclet/context.md` — project stack, conventions, and constraints
   - Read `.speclet/tasks/index.md` — the phase map (lists all phases and their task file paths)
   - If `.speclet/constitution.md` exists and does **NOT** contain `<!-- speclet:unfilled -->`, read it for project ground rules

2. **Determine scope**:
   - If a phase number or name was provided, process only that phase
   - Otherwise process all phases, **one at a time** — never load all phase files simultaneously

3. **For each phase to process**:
   - Find the phase entry in `.speclet/tasks/index.md`
   - If the task file already exists (e.g., `.speclet/tasks/phase-1-setup.md`), read it — you may revise existing tasks
   - If the task file does not exist, find the source plan file from `.speclet/plans/` listed for that phase
   - Generate concrete, ordered tasks for the phase
   - Write the tasks to the task file path listed in the index

4. **Task format rules**:
   ```
   - [ ] **Task title** — brief description of what to do and what done looks like
   ```
   - Each task must be **atomic** — one clear unit of work
   - Each task must be **specific** — enough detail to implement without re-reading the plan
   - Tasks must be **ordered** — listed in the sequence they should be done
   - Do not duplicate tasks across phases
   - Reference the stack from `.speclet/context.md`
   - Respect constraints from `.speclet/constitution.md` (testing, architecture, quality rules)

5. **Report**: List the task files created or updated and the total task count per phase.
