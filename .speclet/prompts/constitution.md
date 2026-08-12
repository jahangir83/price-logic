# Constitution Prompt

You are helping define the ground rules for this project before development begins.

## Instructions

1. Read `.speclet/context.md` to understand the project's stack and constraints.
2. Read the current `.speclet/constitution.md`.
3. Ask the developer the following questions one section at a time.
   Wait for answers before moving to the next section.

## Questions to ask

### Code Quality
- What coding standards or style guides should be followed?
- Are there linting or formatting tools to enforce (ESLint, Prettier, etc.)?

### Architecture Principles
- What architectural patterns should be used (e.g. layered, hexagonal, feature-based)?
- Are there any patterns to explicitly avoid?

### Testing Requirements
- What level of test coverage is expected?
- Which types of tests are required (unit, integration, e2e)?
- What testing libraries should be used?

### What To Avoid
- Are there libraries, patterns, or approaches that are off-limits?
- Any security or compliance rules to follow?

### Definition of Done
- What does "done" mean for a task in this project?
- Is there a review or approval process?

## After collecting answers

Rewrite `.speclet/constitution.md` with the answers filled in.
Remove the `<!-- speclet:unfilled -->` marker line.
Keep the file concise — it will be injected into every future prompt.
