---
name: speclet-map
description: Perform a full retroactive speclet setup of an existing codebase — scan, document, infer ground rules, and record all past work as completed tasks.
---

# speclet map

Produce every speclet file as if this project had been using speclet from the start, with all existing work already documented and marked done — so new features can be planned and implemented immediately.

## Files to produce

| File | What it is |
|---|---|
| `.speclet/context.md` | Real stack, module structure, conventions, constraints |
| `.speclet/architecture.md` | Module map, key files, data flow, integrations, tech debt |
| `.speclet/constitution.md` | Ground rules inferred from the codebase |
| `.speclet/plans/01-existing.md` | Plan file with phases describing what was built |
| `.speclet/tasks/index.md` | Phase map |
| `.speclet/tasks/phase-N-*.md` | Task files — all tasks marked `[x]` done |

## Instructions

1. **Deep scan the codebase**:
   - Read project tree and all config files (package.json, tsconfig, lint/prettier configs, CI, Dockerfile)
   - Read 2–4 representative source files per layer/module
   - Read README, CHANGELOG, docs/, ADR files
   - Check `git log --oneline -20` if available

2. **Write `.speclet/context.md`** — real stack, module structure, conventions, test setup, constraints

3. **Write `.speclet/architecture.md`** — module table, key files, data flow, external integrations, tech debt

4. **Write `.speclet/constitution.md`** — infer from evidence, do NOT ask questions:
   - Code Quality: from lint/prettier configs, tsconfig strict settings
   - Architecture Principles: from folder structure, import patterns, layering
   - Testing Requirements: from test config, coverage settings, sample test files
   - What To Avoid: from lint rules that ban things, absent patterns
   - Definition of Done: from CI pipeline, PR templates
   - Remove the `<!-- speclet:unfilled -->` marker — this constitution is filled

5. **Group existing work into phases** — divide all implemented work into logical increments in the order they would have been built

6. **Write `.speclet/plans/01-existing.md`** — one `##` heading per phase with a 2–4 sentence description

7. **Write `.speclet/tasks/index.md`** — one bullet per phase pointing at its task file

8. **Write task files** — one `.speclet/tasks/phase-N-<slug>.md` per phase:
   - Header: `Status: Complete` and `Completed: <date>`
   - 5–10 concrete tasks per phase, every task `[x]` done

9. **Report**: list all files written, stack detected, phases mapped, suggest next steps
