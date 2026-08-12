# speclet analyze

Analyze tasks for gaps, conflicts, and risks, then update task files and implement fixes.

Phase (optional): $ARGUMENTS

1. Read `.speclet/context.md` and `.speclet/constitution.md` (if present and filled in).
2. Read `.speclet/tasks/index.md`.
3. If a phase number or name was given in $ARGUMENTS, load only that phase file.
   Otherwise load each phase file one at a time — do not load all at once.
4. **Run the analysis first**. If a follow-up instruction was provided:
   a. Update affected task/phase files to reflect needed changes FIRST.
   b. Then implement the described code changes.
   Task files must stay in sync as the source of truth.
5. Follow the instructions in `.speclet/prompts/analyze.md`.
