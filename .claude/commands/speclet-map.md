# speclet map

Perform a full retroactive speclet setup of an existing codebase.

This command produces every speclet file as if speclet had been used from the start, with all existing work documented and marked done so new features can be planned immediately.

Files to produce:
- `.speclet/context.md` — real stack, conventions, module structure, constraints
- `.speclet/architecture.md` — module map, key files, data flow, integrations, tech debt
- `.speclet/constitution.md` — ground rules inferred from lint config, patterns, test setup, CI
- `.speclet/plans/01-existing.md` — plan file with `##` phases describing what was built
- `.speclet/tasks/index.md` — phase map
- `.speclet/tasks/phase-N-*.md` — one task file per phase, all tasks marked `[x]` done

Follow the instructions in `.speclet/prompts/map.md` step by step.
