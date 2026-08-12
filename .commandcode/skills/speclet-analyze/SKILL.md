---
name: speclet-analyze
description: Analyze speclet tasks for gaps, conflicts, risks, and constitution violations, then update task files and implement fixes.
---

# speclet analyze

Identify inconsistencies, gaps, conflicts, and risks across task files **before implementation begins**, then handle any follow-up instruction.

**MUST RUN THE ANALYSIS FIRST** — do not skip to the follow-up. Output the analysis report, then address what the user asked.

## Instructions

If a phase number or name is provided in the user's message, analyze **only that phase**. Otherwise analyze all phases.
If the user provided a follow-up instruction (e.g., "fix the found issues"), run the full analysis first, then address that instruction.

1. **Load context**:
   - Read `.speclet/context.md` — project stack and constraints
   - Read `.speclet/tasks/index.md` — full phase map
   - If `.speclet/constitution.md` exists and does **NOT** contain `<!-- speclet:unfilled -->`, read it — constitution violations are always **CRITICAL**

2. **Load task files**:
   - If a phase was specified, load only that phase file
   - Otherwise load each phase file **one at a time** — never all at once
   - For each phase file, extract: task IDs, descriptions, file paths

3. **Run detection passes**:

   **A. Conflicts** — tasks that contradict or overlap each other
   - Same file being created by two tasks in different phases
   - Contradictory patterns (e.g., one task uses REST, another uses GraphQL without explanation)

   **B. Gaps** — missing tasks implied by the plan
   - Features mentioned in `.speclet/plans/` with no corresponding tasks
   - Dependencies between tasks that aren't captured (e.g., a service used before it's created)

   **C. Risks** — tasks that are vague, high-effort, or have unclear success criteria
   - Tasks without file paths
   - Tasks described as "implement the whole X" without breakdown
   - Tasks that seem to span multiple phases

   **D. Constitution violations** (if constitution is present)
   - Any task that contradicts a principle in `.speclet/constitution.md`
   - These are always **CRITICAL** severity

4. **Produce analysis report** (markdown):

   ```
   ## Analysis Report

   ### Conflicts
   - [ ] **[phase-file]** Description of conflict

   ### Gaps
   - [ ] **[phase-file]** Description of gap

   ### Risks
   - [ ] **[phase-file]** Description of risk

   ### Constitution Violations
   - [ ] **[phase-file]** Description of violation (CRITICAL)

   ### Suggestions
   - [ ] Optional improvements to task ordering or grouping
   ```
   If no issues found in a category, write "None found."

5. **Provide next actions**:
   - If CRITICAL issues exist: recommend resolving before `/speclet-implement`
   - If only LOW/MEDIUM: user may proceed, provide improvement suggestions
   - Suggest explicit next command

## Follow-up Handling

If the user provided a follow-up instruction (e.g., "fix the found issues"):

1. **Update task/phase files FIRST** — add, modify, or remove tasks in the affected phase files to reflect the needed changes. Create new phase/task files if needed. This keeps task files in sync as the source of truth.
2. **Then implement code changes** — make the actual code edits described by the updated tasks.
Task files MUST be updated before code changes — never skip straight to implementation.
