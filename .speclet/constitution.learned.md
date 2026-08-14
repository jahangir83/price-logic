# Learned Constitution

<!-- speclet:learned -->
> Rules auto-captured during implementation sessions.
> Run "speclet learn" to review and merge rules into constitution.md.

## Pending Rules

<!-- Rules are appended here by the agent during implementation. Format:
### [YYYY-MM-DD] category: short-title
**Rule:** What to always do.
**Why:** What went wrong or why this matters.
-->

### [2026-08-14] tooling: npm install dies silently on this machine
**Rule:** Wrap large `npm install` runs in a retry loop (with a full
`node_modules` wipe between attempts). Treat an exit code with no `npm error`
reason as "retry", not "broken dependency".
**Why:** Installs on this box die mid-resolution with no error line at all,
at a different package each time, while `curl` to the registry succeeds. Each
attempt warms npm's packument cache, so the failure is self-curing — the
shared package needed 13 attempts, the apps 1–2 once the cache was warm. This
is the same class of environment flakiness already noted for `npm run`
returning before its ts-node child exits.

**Deferred 2026-08-14** — true of this machine, not of the project. Belongs in
a README note rather than the constitution, where it would mislead whoever
runs CI. Revisit if a second machine shows the same behaviour.
