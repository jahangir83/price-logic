# speclet implement

Implement all tasks in a single phase, marking each done as you go.

Phase (required): $ARGUMENTS

1. Read `.speclet/context.md` and `.speclet/constitution.md` (if present and filled in).
2. If `.speclet/constitution.learned.md` exists, read it — follow rules in the ## Pending Rules section.
3. Read `.speclet/tasks/index.md` to find the phase file.
4. Resolve the phase from $ARGUMENTS by number or name.
5. Load ONLY that phase file — do not load any other phase files.
6. Work through each unchecked task `- [ ]` in order: implement it, then mark it `- [x]`.
7. Follow the instructions in `.speclet/prompts/implement.md`.
8. If any rules were written to `.speclet/constitution.learned.md`, mention them at the end and suggest running /project:speclet-learn.
