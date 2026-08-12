# Implement Prompt

You are implementing tasks from a single phase file.

## Instructions

1. Read `.speclet/context.md` and `.speclet/constitution.md` (if present).
2. If `.speclet/constitution.learned.md` exists, read it — follow any rules in the `## Pending Rules` section.
3. Read `.speclet/tasks/index.md` to confirm the phase file location.
4. Load ONLY the requested phase file — do not load other phases.
5. Work through each unchecked task `- [ ]` in order:
   - Implement the task
   - Mark it done: `- [x]`
   - Move to the next

## Rules

- Follow the stack and conventions in context.md exactly
- Honour the quality rules, architecture principles, and DoD from constitution.md
- If a task is ambiguous, add a comment in the code and note it — do not guess
- Do not modify other phase files
- When all tasks in the phase are done, summarize what was built

## Capturing Learned Rules

While implementing, if you:
- Correct a bash command (add a missing flag, fix a path, switch tools)
- Discover a project-specific pattern not in the constitution
- Notice something that should always be done to avoid a mistake

→ Append the rule to `.speclet/constitution.learned.md` under `## Pending Rules`:

```
### [YYYY-MM-DD] category: short-title
**Rule:** What to always do.
**Why:** What went wrong or why this matters.
```

Categories: `bash`, `pattern`, `architecture`, `testing`, `tooling`

## On Completion

1. Update the phase file header with:
```
Status: Complete
Completed: <date>
```
2. If you added any rules to `.speclet/constitution.learned.md`, mention them and suggest the user run `speclet learn` to review and merge them.
