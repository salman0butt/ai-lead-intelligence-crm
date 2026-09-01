# Milestone 4 Business Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute durable provider-isolated business discovery from M3 SearchTasks, normalize/store candidates with provenance and provider usage, and make pagination/pause/resume crash-safe.

**Architecture:** Add a provider-neutral `@ai-crm/discovery` package with a real Google Places Text Search adapter. Persist candidate/provenance/usage/cursor state in Prisma. Extend the existing campaign-plan worker into an idempotent planning-to-discovery scheduler and add a `campaign-discovery` worker whose queue payload contains identifiers/version/page only while provider page tokens remain in PostgreSQL.

**Tech Stack:** TypeScript 6, PostgreSQL 17, Prisma, pg-boss 12.28.0, native fetch, Zod config, Vitest, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-01-milestone-4-business-discovery-design.md`

## Global Constraints

- Keep PostgreSQL/pg-boss; do not add Redis, BullMQ, RabbitMQ, Kafka, or Temporal.
- Provider code must remain isolated in `packages/discovery`.
- Standard CI must not require or spend a Google Places credential.
- Use Places API (New) Text Search through native `fetch`, not a Google SDK.
- Keep provider page tokens in PostgreSQL, not as the queue source of truth.
- `campaign-discovery` remains the established queue name.
- Do not introduce canonical `Business` deduplication, website verification, crawling, contact enrichment, audit, AI research, result UI, or outreach in M4.
- Every production behavior follows TDD: failing behavior test first, expected RED, minimal implementation, green verification.

---

### Task 1: Create the discovery provider package and Google adapter

**Files:**
- Modify: `package.json`
- Create: `packages/discovery/package.json`
- Create: `packages/discovery/tsconfig.json`
- Create: `packages/discovery/tsconfig.build.json`
- Create: `packages/discovery/src/types.ts`
- Create: `packages/discovery/src/provider-registry.ts`
- Create: `packages/discovery/src/google-places.provider.ts`
- Create: `packages/discovery/src/index.ts`
- Create: `packages/discovery/test/google-places.provider.test.ts`
- Create: `packages/discovery/test/provider-registry.test.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `.env.example`
- Modify: `packages/config/test/env.test.ts`

**Interfaces:**

```ts
export interface BusinessSearchInput {
  query: string;
  country: string;
  region: string;
  city: string;
  geographicCell: string;
  pageSize?: number;
}

export interface BusinessDiscoveryPage<TRaw> {
  results: readonly TRaw[];
  nextPageToken: string | null;
}

export interface NormalizedBusiness {
  providerExternalId: string;
  name: string;
  formattedAddress: string;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  rawReference: string | null;
}

export interface BusinessDiscoveryProvider<TRaw = unknown> {
  readonly name: string;
  searchBusinesses(input: BusinessSearchInput): Promise<BusinessDiscoveryPage<TRaw>>;
  getNextPage(input: BusinessSearchInput, pageToken: string): Promise<BusinessDiscoveryPage<TRaw>>;
  normalizeResult(raw: TRaw): NormalizedBusiness;
}
```

- [ ] **Step 1: write provider/config tests before package implementation**

Tests must assert:

```ts
expect(serverEnvSchema.parse({ ...base, GOOGLE_PLACES_API_KEY: '' }).GOOGLE_PLACES_API_KEY).toBeUndefined();
```

Google provider test uses injected `fetch` and asserts:

```ts
expect(fetcher).toHaveBeenCalledWith(
  'https://places.googleapis.com/v1/places:searchText',
  expect.objectContaining({ method: 'POST' }),
);
```

Request JSON for `{ query: 'Dentist', country: 'United States', region: 'Texas', city: '', geographicCell: '' }` must include:

```ts
{ textQuery: 'Dentist in Texas', pageSize: 20 }
```

Headers must include the API key and exact field mask from the spec.

A next-page call must include the same `textQuery`/`pageSize` plus `pageToken`.

Normalization fixture:

```ts
{
  id: 'place-1',
  displayName: { text: 'Example Dental' },
  formattedAddress: '123 Main St, Austin, TX',
  primaryType: 'dentist',
  location: { latitude: 30.1, longitude: -97.7 },
}
```

must normalize to the provider-neutral shape.

429 response must reject with a `DiscoveryProviderError` having `statusCode === 429` and `rateLimited === true`.

Registry test must resolve a registered `google-places` provider and throw a clear error for an unknown/unconfigured provider.

- [ ] **Step 2: enable M4 branch CI and run to verify RED**

Modify `.github/workflows/ci.yml` push branches to include `feat/milestone-4-business-discovery`.

Expected RED: missing `@ai-crm/discovery` files/types and missing Google config.

- [ ] **Step 3: implement package/config minimally**

`GooglePlacesDiscoveryProvider` constructor:

```ts
constructor(apiKey: string, fetcher: typeof fetch = fetch)
```

Field mask:

```text
places.id,places.displayName,places.formattedAddress,places.primaryType,places.location,nextPageToken
```

Text target selection:

```ts
const place = input.geographicCell || input.city || input.region || input.country;
const textQuery = `${input.query} in ${place}`;
```

Export package interfaces, typed error, Google adapter, and registry from `src/index.ts`.

Add optional `GOOGLE_PLACES_API_KEY` to server env and `.env.example`.

Update root `build:packages` so discovery builds before worker tests/builds.

- [ ] **Step 4: run full CI and verify package/config GREEN**

Required gates: migrations unchanged, tests, typecheck, lint, build, smoke.

- [ ] **Step 5: commit**

Commit message: `feat: add business discovery provider package`.

---

### Task 2: Persist discovery candidates, provenance, usage, cursor, and DISCOVERING lifecycle

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260901120000_business_discovery/migration.sql`
- Modify: `packages/database/src/index.ts`
- Create: `apps/worker/test/business-discovery-persistence.integration.test.ts`
- Modify: `apps/api/test/campaigns.service.test.ts`
- Modify: `apps/api/src/campaigns/campaigns.service.ts`
- Modify: `apps/web/lib/campaigns.ts`
- Modify: `apps/web/test/campaigns.test.ts`

**Interfaces:**
- Adds `CampaignStatus.DISCOVERING`.
- Adds Prisma models `BusinessCandidate`, `BusinessSource`, `ProviderUsage`.
- Extends `SearchTask` with `nextPageToken` and `pageNumber`.

- [ ] **Step 1: write failing persistence tests**

Create a real SearchTask and verify new defaults:

```ts
expect(task.pageNumber).toBe(1);
expect(task.nextPageToken).toBeNull();
```

Create a `BusinessCandidate`, source, and usage row and verify defaults:

```ts
expect(usage.requestCount).toBe(0);
expect(usage.resultCount).toBe(0);
expect(usage.errorCount).toBe(0);
expect(usage.rateLimitCount).toBe(0);
```

Attempt duplicate candidate with same campaign/provider/providerExternalId and assert database uniqueness rejection or upsert reuse. Attempt duplicate source candidate+task and assert uniqueness.

- [ ] **Step 2: write lifecycle RED tests**

Update service tests to require:

```text
pause: PLANNING -> PAUSED
pause: DISCOVERING -> PAUSED
resume: PAUSED -> PLANNING + fresh campaign-plan enqueue
cancel: DISCOVERING -> CANCELLED
```

Resume enqueue payload remains `{workspaceId,campaignId}` and idempotency key must contain the post-transition `updatedAt` generation.

Update frontend status/action helper tests so DISCOVERING exposes `pause` and `cancel`.

- [ ] **Step 3: run CI and verify RED**

Expected failures: missing Prisma fields/models/status plus old resume behavior.

- [ ] **Step 4: implement Prisma schema/migration**

Add:

```prisma
DISCOVERING
```

and the models/fields exactly as specified in the design. Use `Decimal? @db.Decimal(18, 6)` for `ProviderUsage.costAmount`; JSON provenance uses `Json`.

Add indexes on workspace/campaign/provider and search-task relations needed by M4 queries.

- [ ] **Step 5: implement lifecycle changes**

Refactor campaign plan publication to a private helper:

```ts
private async enqueueCampaignPlan(campaign: Campaign) {
  return this.queue.enqueue(
    'campaign-plan',
    { workspaceId: campaign.workspaceId, campaignId: campaign.id },
    { idempotencyKey: `campaign-plan:${campaign.id}:${campaign.updatedAt.toISOString()}` },
  );
}
```

`start()` transitions to PLANNING and calls it. `resume()` transitions PAUSED -> PLANNING and calls it with rollback to PAUSED on publication failure. `pause()` accepts PLANNING or DISCOVERING. `cancel()` includes DISCOVERING.

- [ ] **Step 6: run full CI and verify GREEN**

- [ ] **Step 7: commit**

Commit message: `feat: persist business discovery state`.

---

### Task 3: Schedule SearchTasks after campaign planning

**Files:**
- Create: `apps/worker/src/discovery-scheduler.ts`
- Create: `apps/worker/test/discovery-scheduler.test.ts`
- Modify: `apps/worker/src/campaign-plan.processor.ts`
- Modify: `apps/worker/test/campaign-plan.processor.test.ts`
- Modify: `apps/worker/src/job-worker.ts`

**Interfaces:**

```ts
export interface DiscoveryJobPayloadInput {
  workspaceId: string;
  campaignId: string;
  searchTaskId: string;
  campaignVersion: string;
  pageNumber: string;
}

export async function scheduleSearchTaskDiscovery(
  queue: QueueService,
  input: DiscoveryJobPayloadInput,
): Promise<QueueJobResult>
```

Idempotency:

```text
campaign-discovery:<searchTaskId>:<campaignVersion>:page:<pageNumber>
```

- [ ] **Step 1: write failing scheduler tests**

Assert exact queue name, identifier/version/page payload, and idempotency key.

Assert scheduling 3 SearchTasks creates 3 independent queue calls.

- [ ] **Step 2: write failing production campaign-plan handoff test**

Use a DB/queue mock where planning returns/reuses tasks. Require the default processor to:

1. create/reuse planning.
2. transition campaign `PLANNING -> DISCOVERING` conditionally.
3. schedule each unfinished task using the DISCOVERING row's `updatedAt` as version.

Replay from already `DISCOVERING` must schedule pending/failed tasks again through deterministic idempotency without changing the campaign generation.

PAUSED/CANCELLED after planning must schedule nothing.

- [ ] **Step 3: run CI and verify RED**

- [ ] **Step 4: implement scheduler and campaign-plan orchestration**

Change `processCampaignPlanJob` production signature to receive a `QueueService` (preserve injected task seam for focused tests). `registerJobWorkers` passes the existing queue.

Use conditional `campaign.updateMany` for `PLANNING -> DISCOVERING`; if it loses a race, reload and accept `DISCOVERING`, `PAUSED`, or `CANCELLED` according to the spec.

Read SearchTasks where status is `PENDING` or `FAILED` and schedule their persisted `pageNumber`.

- [ ] **Step 5: update real pg-boss planning integration**

After an independent campaign-plan worker completes, assert:

- campaign is `DISCOVERING`.
- SearchTasks exist.
- `JobMetadata` contains `campaign-discovery` jobs for tasks.

Do not consume those discovery jobs in this task.

- [ ] **Step 6: run full CI and verify GREEN**

- [ ] **Step 7: commit**

Commit message: `feat: schedule campaign discovery work`.

---

### Task 4: Execute one discovery page transactionally

**Files:**
- Create: `apps/worker/src/business-discovery.processor.ts`
- Create: `apps/worker/test/business-discovery.processor.test.ts`
- Create: `apps/worker/test/business-discovery.integration.test.ts`
- Modify: `apps/worker/src/job-worker.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**

```ts
export interface CampaignDiscoveryPayload extends QueuePayload {
  campaignId: string;
  searchTaskId: string;
  campaignVersion: string;
  pageNumber: string;
}

export async function processBusinessDiscoveryJob(
  database: DatabaseClient,
  queue: QueueService,
  providers: DiscoveryProviderRegistry,
  job: QueueWorkJob,
): Promise<void>
```

- [ ] **Step 1: write RED tests for stale validation and provider isolation**

Cases:

- payload workspace/campaign/task mismatch -> reject before provider call.
- campaign PAUSED/CANCELLED -> success no-op, provider not called.
- campaign version mismatch -> success no-op.
- COMPLETED/CANCELLED SearchTask -> success no-op.
- page higher than persisted page -> reject.

- [ ] **Step 2: write RED happy-path integration test**

Create a DISCOVERING campaign, plan, SearchTask, registry with deterministic fake provider returning two raw businesses, then process one job.

Assert:

```text
SearchTask COMPLETED
attemptCount 1
resultCount 2
uniqueBusinessCount 2
2 BusinessCandidate rows
2 BusinessSource rows
ProviderUsage requestCount 1
ProviderUsage resultCount 2
```

Process equivalent discovery from another SearchTask returning one existing provider ID plus one new provider ID. Assert candidate total becomes 3, not 4, while provenance reflects both SearchTasks.

- [ ] **Step 3: run CI and verify RED**

- [ ] **Step 4: implement claim/provider/result transaction**

Before call, atomically claim `PENDING | FAILED -> RUNNING` and increment attempts.

Upsert aggregate ProviderUsage and increment request before I/O.

Normalize all provider records before transaction; invalid raw records throw and use provider failure path rather than silently fabricating identifiers.

Within result transaction upsert candidates, insert provenance idempotently, update counters/cursor/status, and increment usage results.

- [ ] **Step 5: implement provider failure path**

On any provider call error:

```text
RUNNING -> FAILED
ProviderUsage.errorCount += 1
ProviderUsage.rateLimitCount += 1 only for DiscoveryProviderError.rateLimited
throw
```

Do not modify campaign status.

Unit/integration tests assert unrelated SearchTasks and campaign DISCOVERING state remain intact.

- [ ] **Step 6: compose provider registry in worker main**

Add `@ai-crm/discovery` dependency to worker.

Worker startup:

```ts
const providers = new DiscoveryProviderRegistry();
if (env.GOOGLE_PLACES_API_KEY) {
  providers.register(new GooglePlacesDiscoveryProvider(env.GOOGLE_PLACES_API_KEY));
}
```

Register the `campaign-discovery` consumer even when registry is empty.

- [ ] **Step 7: run full CI and verify GREEN**

- [ ] **Step 8: commit**

Commit message: `feat: process business discovery pages`.

---

### Task 5: Make pagination crash-safe and resumable

**Files:**
- Modify: `apps/worker/src/business-discovery.processor.ts`
- Modify: `apps/worker/test/business-discovery.processor.test.ts`
- Modify: `apps/worker/test/business-discovery.integration.test.ts`

- [ ] **Step 1: write RED next-page test**

Fake provider returns page 1 with `nextPageToken = 'token-2'`.

After processing assert:

```text
SearchTask.status == PENDING
SearchTask.pageNumber == 2
SearchTask.nextPageToken == 'token-2'
```

and queue receives page 2 with deterministic idempotency.

Process page 2 and assert provider `getNextPage()` receives the persisted token, task becomes COMPLETED, and token becomes null.

- [ ] **Step 2: write RED crash-repair test**

Make page-2 enqueue throw after page-1 persistence. Assert the page-1 job rejects while DB remains at page 2/token-2.

Replay the original page-1 payload. Assert:

- provider call count remains one.
- processor schedules page 2 from persisted state.
- result counters do not increment again.

- [ ] **Step 3: run CI and verify RED**

- [ ] **Step 4: implement page-ahead repair path**

When `payloadPage < task.pageNumber`:

```ts
if (task.nextPageToken) {
  await scheduleSearchTaskDiscovery(queue, current persisted page/version identifiers);
}
return;
```

Do not claim the task or call the provider in this path.

After a successful current-page transaction with a next token, schedule the new persisted page. Let scheduling errors rethrow so pg-boss invokes repair on retry.

- [ ] **Step 5: run full CI and verify GREEN**

- [ ] **Step 6: commit**

Commit message: `feat: make discovery pagination resumable`.

---

### Task 6: Verify pause/resume generation behavior end-to-end

**Files:**
- Modify: `apps/worker/test/business-discovery.integration.test.ts`
- Modify: `apps/api/test/campaigns.service.test.ts`

- [ ] **Step 1: add RED integration sequence**

Sequence:

1. campaign DISCOVERING generation A with queued discovery job A.
2. transition campaign to PAUSED.
3. process old job A and assert provider not called.
4. API resume transitions PAUSED -> PLANNING and publishes fresh campaign-plan generation B.
5. campaign-plan replay returns to DISCOVERING and schedules unfinished task with generation C (the DISCOVERING row version).
6. process fresh discovery job and assert provider is called and candidate persisted.

Also cancel a DISCOVERING campaign and verify an old queued job performs no provider I/O.

- [ ] **Step 2: run CI and verify RED if any lifecycle gap remains**

- [ ] **Step 3: make only minimal production corrections required by the sequence**

No new orchestration subsystem is allowed; use existing campaign service, planner replay, version checks, and deterministic idempotency.

- [ ] **Step 4: run full CI and verify GREEN**

- [ ] **Step 5: commit**

Commit message: `test: verify resumable campaign discovery lifecycle`.

---

### Task 7: Live-provider opt-in, docs, review, and merge gate

**Files:**
- Create: `packages/discovery/test/google-places.live.test.ts`
- Modify: `README.md`
- Create or Modify: `docs/milestones/STATUS.md`
- Review: full diff from M3 `main` to M4 candidate.

- [ ] **Step 1: add opt-in live Google test**

Guard:

```ts
const live = process.env.GOOGLE_PLACES_API_KEY && process.env.RUN_LIVE_DISCOVERY_TESTS === '1'
  ? describe
  : describe.skip;
```

Perform one first-page Text Search such as `Dentist` in `Austin, Texas, United States`, normalize the first result, and assert non-empty provider ID/name. Never run this test in normal CI without explicit opt-in.

- [ ] **Step 2: update README and status ledger**

README documents:

- M4 discovery architecture.
- Google provider configuration.
- standard vs live test behavior.
- candidate/source/usage persistence.
- pagination recovery.
- pause/resume generation invalidation.
- M5 boundary.

`docs/milestones/STATUS.md` records M0–M3 complete, M4 candidate/complete state, and M5–M24 remaining in exact roadmap order.

- [ ] **Step 3: run exact-head full CI**

Require success for:

```text
Install dependencies (frozen lockfile)
Validate Prisma schema
Apply database migrations
Run tests
Typecheck
Lint
Build
Smoke test compiled applications
```

- [ ] **Step 4: perform final review against the spec/master roadmap**

Verify:

- no M5 canonical/fuzzy deduplication.
- no crawling/enrichment/AI/result UI.
- no Google code outside discovery package/composition.
- no paid request in default CI.
- secrets remain server-side.
- provider token never becomes queue source of truth.
- exact candidate/source uniqueness exists in DB.
- replay cannot double-apply committed page counters.
- pause/resume/cancel prevent stale provider I/O.
- provider failure leaves campaign/other tasks intact.
- no forbidden queue infrastructure.

Fix all Critical/Important findings and rerun exact-head CI after any fix.

- [ ] **Step 5: open PR**

Title:

```text
Milestone 4: Business discovery
```

Require PR CI on the exact reviewed head.

- [ ] **Step 6: squash-merge with `expected_head_sha` guard**

- [ ] **Step 7: verify post-merge `main` CI**

Do not mark M4 complete or start M5 until the workflow triggered by the M4 merge commit passes every required gate.
