# speclet tasks

Generate concrete tasks for a plan phase and write them to the phase file.

Phase (optional): $ARGUMENTS

1. Read `.speclet/context.md` and `.speclet/constitution.md` (if present and filled in).
2. Read `.speclet/tasks/index.md` to see the phase map.
3. If a phase number or name was given in $ARGUMENTS, process only that phase.
   Otherwise process all phases one at a time — never load all phase files at once.
4. For each phase, load its plan content from `.speclet/plans/`, generate tasks, and write them to the task file listed in the index.
5. Follow the instructions in `.speclet/prompts/tasks.md`.
