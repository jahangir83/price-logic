# Tasks Prompt

You are breaking a plan phase into concrete, actionable development tasks.

## Instructions

1. Read `.speclet/context.md` and `.speclet/constitution.md` (if present).
2. Read `.speclet/tasks/index.md` to see which phase files exist.
3. For each phase (or the requested phase only):
   - Load the phase file from `.speclet/tasks/`
   - Generate tasks for that phase
   - Write the tasks back into that phase file under the ## Tasks section
   - Do NOT load other phase files while working on one

## Task Format

Each task must be:
- Atomic — one clear unit of work
- Specific — includes enough detail to implement without re-reading the plan
- Ordered — listed in the sequence they should be done

```
- [ ] **Task title** — brief description of what to do and what done looks like
```

## Rules

- Process one phase file at a time to minimize token usage
- Do not duplicate tasks across phases
- Reference the stack from context.md
- Respect constraints from constitution.md (testing, architecture, quality rules)
