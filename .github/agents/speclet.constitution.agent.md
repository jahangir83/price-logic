---
description: Fill in or update the speclet project constitution with your project's ground rules and principles.
handoffs:
  - label: Generate Tasks
    agent: speclet.tasks
    prompt: Generate tasks for all phases
    send: true
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Fill in or update `.speclet/constitution.md` with concrete project ground rules.
The constitution is injected into every future speclet prompt, so keep it concise and actionable.

## Outline

1. **Load context**:
   - Read `.speclet/context.md` — project stack and conventions
   - Read `.speclet/constitution.md` — current state (may contain placeholder markers)

2. **Check constitution state**:
   - If the file contains `<!-- speclet:unfilled -->`, this is a **first-time setup**
   - Otherwise, this is an **update or review**

3. **First-time setup** (if unfilled):
   Ask the developer the following questions **one section at a time**. Wait for answers before proceeding.

   **Code Quality**
   - What coding standards or style guides should be followed?
   - Are there linting or formatting tools to enforce (ESLint, Prettier, etc.)?

   **Architecture Principles**
   - What architectural patterns should be used (e.g. layered, hexagonal, feature-based)?
   - Are there any patterns to explicitly avoid?

   **Testing Requirements**
   - What level of test coverage is expected?
   - Which types of tests are required (unit, integration, e2e)?
   - What testing libraries should be used?

   **What To Avoid**
   - Libraries, patterns, or approaches that are off-limits?
   - Any security or compliance rules to follow?

   **Definition of Done**
   - What does "done" mean for a task in this project?
   - Is there a review or approval process?

4. **Update mode** (if already filled):
   - If `$ARGUMENTS` specifies a section to update, focus on that section
   - Otherwise review the full constitution and ask if anything needs updating

5. **Write back**: Rewrite `.speclet/constitution.md` with answers filled in.
   - Remove the `<!-- speclet:unfilled -->` marker line
   - Keep the file concise — it is injected into every future prompt

6. **Report**: Confirm the file was saved and list which sections were updated.
