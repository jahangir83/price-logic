---
name: speclet-clarify
description: Generate targeted clarifying questions about the plan or a specific phase before implementation begins.
user-invocable: true
allowed-tools:
  - read
  - write_file
  - ask_user_question
---

# speclet clarify

Detect and surface ambiguities, missing decisions, and underspecified areas in the plan **before** task generation or implementation begins.

## Instructions

If a phase number or name is provided in the user's message, clarify **only that phase**. Otherwise clarify the full plan.

1. **Load context**:
   - Read `.speclet/context.md` — project stack and constraints
   - If `.speclet/constitution.md` exists and does **NOT** contain `<!-- speclet:unfilled -->`, read it too

2. **Load the plan or phase**:
   - If a phase was specified, find its task file in `.speclet/tasks/index.md` and read it
   - If no phase specified, read the plan files in `.speclet/plans/`

3. **Scan for ambiguities** across these categories:
   - **Scope** — what is explicitly in/out of scope?
   - **Technical** — ambiguous implementation decisions (libraries, patterns, data shapes)
   - **Dependencies** — external services, APIs, or data sources not fully specified
   - **Edge cases** — scenarios not addressed (errors, empty states, concurrency, limits)
   - **Non-functional** — performance, security, or scalability requirements missing measurable targets

4. **Generate clarifying questions**:
   - Maximum **5 questions** total, prioritized by impact on implementation
   - Each question must be answerable with a short answer or a choice between 2–4 options
   - For each question with options, **recommend the best option** with brief reasoning
   - Ask questions **one at a time** — wait for the answer before the next

5. **Record answers** (if user answers during this session):
   - After each answer, note whether it changes implementation approach
   - If the plan or task file should be updated based on the answer, do so immediately

6. **Report**:
   - Number of questions asked
   - Summary of any decisions made
   - Suggested next step (`/speclet-tasks` or `/speclet-implement`)
