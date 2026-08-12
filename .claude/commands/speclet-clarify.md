# speclet clarify

Generate clarifying questions about the plan or a specific phase.

Phase (optional): $ARGUMENTS

1. Read `.speclet/context.md` and `.speclet/constitution.md` (if present and filled in).
2. If a phase number or name was given in $ARGUMENTS, read only that phase file from `.speclet/tasks/`.
   Otherwise read the plan files in `.speclet/plans/`.
3. Follow the instructions in `.speclet/prompts/clarify.md`.
