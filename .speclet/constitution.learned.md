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

### [2026-08-15] tooling: pnpm copies `file:` deps, so shared changes do not propagate
**Rule:** After changing `packages/shared`, run `npm run build` there **and then
`pnpm install` in `backend/` and `frontend/`** (sequentially — never two installs
at once). Rebuilding shared alone is not enough.
**Why:** npm symlinks a `file:` dependency; pnpm hard-copies it into
`node_modules/.pnpm/@pricelogic+shared@file+..+packages+shared/`. After adding
`StoreSettings` and `ShopOnboarding` to the shared package and rebuilding it,
the backend still failed with `Module '"@pricelogic/shared"' has no exported
member 'ShopOnboarding'` — the apps were compiling against a copy taken at
install time. The failure is at least loud rather than silent, but it looks like
a missing export rather than a stale copy. Switching both apps to
`link:../packages/shared` would make pnpm symlink instead and remove the step;
that changes the dependency protocol to a pnpm/yarn-specific one, so it is a
decision to take deliberately rather than a side effect of a task.

**Follow-on, 2026-08-16:** after that `pnpm install`, the IDE keeps reporting
`has no exported member` for the newly added export even though `tsc --noEmit`
exits 0. pnpm replaces the whole package directory rather than editing files in
place, and a directory swap does not reliably fire the watch events the
TypeScript language server relies on, so it serves the declaration it read at
startup. **Restart the TS server** (VS Code: "TypeScript: Restart TS Server").
When the IDE and `tsc` disagree after a shared-package change, `tsc` is right.

### [2026-08-16] jobs: a step is a unit of work with its own result, not a cursor
**Rule:** Each job type declares an ordered list of steps, and **every step
records its own status, try count, progress and result**. A later step reads an
earlier step's output rather than recomputing it; a retry or a resume re-enters
at the recorded step rather than at the start of the job.
**Why:** Modelled on FlashX (`app/modules/job/job.ts`), where a job class
declares `static steps = ['validate', 'fetchCollections', …]`, each step is a
method of that name, the runner creates one `JobExecution` row per step, and
`getResult(step)` reads a prior step's output. We already have the sequence —
`JOB_STEPS` in `packages/shared/src/domain/job.ts:63` gives `CAMPAIGN_ACTIVATE`
its eight steps, with `nextJobStep`/`firstJobStep` and
`JobContext.advance()`/`advanceTo()`. What we do not have is per-step results:
`job_executions` is one row per *attempt* carrying a `step` cursor
(`job-execution.entity.ts:57`) and a single `result` jsonb for the whole
attempt. So "which step did attempt 1 die on, and what had the steps before it
produced?" is only half answerable — and that is exactly the question asked
about a half-applied campaign.

**Open decision:** one execution row per step (FlashX's shape) versus keeping
one row per attempt and adding a per-step results table. The first makes
`(job, step)` directly queryable and matches the reference; the second keeps
the attempt as the retry unit, which is what the existing
`@Unique(['jobId', 'attempt'])` guard is built on.

### [2026-08-16] jobs: the dispatcher is a bounded in-process pool
**Rule:** Work is executed by a fixed-size in-process pool polling Postgres —
claims are worker-scoped and released on shutdown, `RUNNING` rows untouched
past the stale-lock window are reclaimed, and concurrency is a pool size rather
than unbounded promise fan-out. Nothing outside the pool executes a handler.
**Why:** This is what `job-dispatcher.service.ts` already does (`inFlight` set
bounded by `jobs.concurrency`, `releaseClaims(workerId)` on shutdown,
`reclaimStale`). The constitution says Postgres is the queue but never states
the pool discipline, so when BullMQ or RabbitMQ replaces dispatch — expected
roughly six months post-launch — there is no written rule saying which
properties the replacement has to preserve. Releasing claims explicitly is the
non-obvious one: without it a rolling deploy leaves every held job RUNNING and
untouchable until the stale-lock timeout.

### [2026-08-16] shopify: bulk operations are the default path for products and variants
**Rule:**
- **Reads always use `bulkOperationRunQuery`.** Fetching products and variants
  from Shopify goes through a bulk query, never a paginated `products(first:…)`
  loop.
- **Writes switch on size at 500 variants.** At **500 or more** variants, use
  `bulkOperationRunMutation` with a staged JSONL upload. A single bulk mutation
  carries at most **5,000 variants**, so larger sets are split into
  5,000-variant operations — one child job per chunk, so each retries alone.
- **Under 500 variants, stay synchronous** and page **25 items per request**,
  looping until the set is exhausted.
- A bulk operation runs on the shop's **offline** access token, its operation id
  is stored on the job row, the job parks while the operation is RUNNING and
  resumes on `bulk_operations/finish`.
**Why:** FlashX does exactly this — `bulkOperationManager.query`/`.mutation`
(`app/modules/bulk-operation-manager.server.ts:566,629`) wrapped by
`performShopifyBulkQuery`/`performShopifyBulkMutation` on the job base class,
which resolve the offline session via `findOfflineSessionByStoreId` and write
`bulkOperationId` onto the job row; the runner then pauses the job while that
operation is live and an emitter resumes it when it finishes. The 25 comes from
`PER_REQUEST_LIMIT = 25` in `campaign-start.server.ts:54` and
`campaign-end.server.ts:29`, which pages 25 *items* — each a product with its
variants — and loops while `items.length === PER_REQUEST_LIMIT`. The 500
threshold and the 5,000 chunk are our own decisions; FlashX's only nearby
constant is `rightVariants.length > 2000`, which merely triggers a `sleep`.

Shopify's own constraints back the shape
(https://shopify.dev/docs/api/usage/bulk-operations/queries): operations are
tracked per app per shop, with five concurrent bulk *queries* per shop from API
version `2026-01` and one per type before that — the docs do not extend that
five to bulk mutations, so plan on one in-flight mutation per shop. A bulk query
needs the same access scopes as the equivalent normal query and reports a
missing one as `ACCESS_DENIED` with no field detail, so run it non-bulk first to
find the offending field. Results are a signed JSONL URL that expires after one
week, which is why the job downloads it during the run rather than deferring;
the operation itself fails after 10 days.

**Conflicts with current code:** `shopify-admin.service.ts:604` writes prices
with `productVariantsBulkUpdate`, which is per-product and synchronous. Adopting
this rule makes that the under-500 path only.

**Unresolved:** which API version we actually send decides whether we get one or
five concurrent bulk queries, and it is currently set three ways —
`configuration.ts:75` defaults to `2026-07`, `env.validation.ts:15` to
`2025-01`, and `shopify-graphql.client.ts:74` falls back to `2025-01`.

**Implemented 2026-08-16** — see `tasks/bulk-operations-job-steps.md`. Rules 3,
4 and 5 are built and tested; they are still pending here because they have not
been reviewed into the constitution, not because the code is missing.

### [2026-08-16] pattern: handing an attempt back must not mean reusing its row
**Rule:** Anything that returns a job to the queue **without consuming its
attempt** — `reclaimStale`, resuming from a bulk operation — must resume the
existing `job_executions` row rather than let the next claim insert a new one.
**Why:** `job_executions` is unique on `(job_id, attempt)`, and both paths
decrement `attempts` so the next claim lands on the same number. The insert in
`claimNext` sits *outside* the try/catch that handles the concurrency-index
race, so the duplicate threw a raw `QueryFailedError` out of the dispatcher
tick, rolled back the claim, and left the job PENDING to fail the same way
forever — a silent infinite loop with a log line that looks like a transient
poll failure. Latent since J2 (a stale reclaim was rare); parking on bulk
operations would have hit it on every single resume.

### [2026-08-16] architecture: controllers and services live in per-module folders
**Rule:** Inside a feature module, `*.controller.ts` goes in `controllers/` and
`*.service.ts` in `services/`, each with its `.spec.ts` beside it. `entities/`
and `dto/` keep their existing folders. Everything else — pure domain logic
(`campaign-rules.ts`, `campaign-status.ts`, `bulk-price-writer.ts`), transport
plumbing (`shopify-graphql.client.ts`, `throttle.ts`, `response-cache.ts`) and
job handlers (`*.handlers.ts`, `job-handler.ts`) — stays at the module root,
because it is neither.
**Why:** Restructured 2026-08-16 on request. Modules stay feature-owned, which
is the constitution's rule; this only groups the layers inside them. Worth
writing down because the boundary is not self-evident: `job-handler.ts` and
`shopify-graphql.client.ts` are both `@Injectable` providers and neither is a
service by this convention, so "is it injectable?" is the wrong test — the file
name is the test.

### [2026-08-16] pattern: a DTO field without a validator is a 400, not a default
**Rule:** Never put an undecorated helper field on a DTO. `main.ts` runs
`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, which rejects
**any own property of the instance** carrying no validation decorator — and a
class field with an initializer is an own property whether or not the client
sent it. Where create and update need different rules, express that in *which
constraint class the DTO attaches*, not in a flag on the payload.
**Why:** `CreateCampaignDto.__isCreate = true` existed to tell the shared
validator it was looking at a create. Every campaign create and update returned
`400 property __isCreate should not exist` — the endpoints were completely
broken — while the whole unit and e2e suite passed, because nothing ran a
payload through the pipe. A flag on the payload was also the wrong shape twice
over: whitelisting it would have let a client send `__isCreate: false` on a
create and skip the "no start date in the past" rule.

### [2026-08-16] testing: validate DTOs through the pipe, not through class-validator
**Rule:** Every DTO with cross-field rules or control fields gets a spec that
calls `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })
.transform(body, { type: 'body', metatype: TheDto, data: '' })` with the same
options as `main.ts`.
**Why:** Calling `validate()` from class-validator directly, or testing the
service under the controller, exercises the constraints but not the whitelist —
which is where the `__isCreate` 400 lived. The pipe is cheap to instantiate and
needs no Nest context, so there is no reason to test one layer below the thing
that actually rejects the request. See
`src/modules/campaigns/dto/campaign.dto.spec.ts`.

### [2026-08-16] testing: a new entity means editing every e2e module by hand
**Rule:** After adding an entity, add it to the `entities:` array of **every**
`test/*.e2e-spec.ts` whose `TypeOrmModule.forRoot` will touch it, and add a stub
provider anywhere a service that now depends on it is constructed by hand.
**Why:** The e2e suites each build their own testing module with an explicit
entity list rather than the app's glob, so a new entity is invisible to them.
The failure is `EntityMetadataNotFoundError: No metadata for "JobStepResult" was
found` from whichever unrelated test happens to touch the code path — 63 tests
across 4 suites failed on one added entity, none of them about the entity. Adding
a constructor dependency fails differently and just as loudly: `Nest can't
resolve dependencies of the ActivationService (…, ?, …)`.
