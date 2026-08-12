# Analyze Prompt

You are reviewing tasks for gaps, conflicts, or risks and then implementing fixes.

**You MUST run the full analysis first**, then handle any follow-up instruction.

## Instructions

1. Read `.speclet/context.md` and `.speclet/constitution.md` (if present).
2. Read `.speclet/tasks/index.md` to understand the full scope.
3. If analyzing a specific phase, load only that phase file.
   Otherwise load each phase file one at a time — do not load all at once.
4. If a `<follow-up>` block is present: run the analysis first, then:
   a. **Update task/phase files FIRST** — add, modify, or remove tasks in affected phase files to reflect needed changes. Create new task files if needed.
   b. **Then implement code changes** — make the actual code edits described by the updated tasks.
   Task files MUST be updated before code changes to keep them in sync as the source of truth.

## Output Format

### Analysis Report

#### Conflicts
Issues where two tasks contradict or overlap each other.
- [ ] **[phase-file]** Description of conflict

#### Gaps
Missing tasks that are implied by the plan but not listed.
- [ ] **[phase-file]** Description of gap

#### Risks
Tasks that are vague, high-effort, or have unclear success criteria.
- [ ] **[phase-file]** Description of risk

#### Suggestions
Optional improvements to task ordering or grouping.
- [ ] ...

If no issues found in a category, write "None found."
