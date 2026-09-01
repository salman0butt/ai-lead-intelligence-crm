# Milestone 3 Search Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a persisted campaign into a durable, resumable `SearchPlan` and deterministic provider/query/geography `SearchTask` search space.

**Architecture:** Keep search planning inside a focused worker-side subsystem. Prisma owns durable plan/task state and uniqueness, pure modules own deterministic niche/geography expansion, and the existing `campaign-plan` pg-boss worker calls the planner through the tracked-job wrapper. M3 creates search space only; M4 will execute provider discovery.

**Tech Stack:** TypeScript, Prisma, PostgreSQL 17, NestJS campaign domain, pg-boss 12.28.0, Vitest, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-01-milestone-3-search-planner-design.md`

## Global Constraints

- Do not add Redis, BullMQ, RabbitMQ, Kafka, or Temporal.
- Do not call Google Places, OpenStreetMap, directories, or other discovery providers in M3.
- Do not add AI niche expansion in M3.
- Keep queue payloads identifier-only: `jobId`, `workspaceId`, `campaignId`.
- Keep planning logic out of `CampaignsService`.
- Preserve M2 campaign lifecycle semantics; planning may run while a campaign is `PAUSED`.
- A repeated planner invocation must not reset existing task status or counters.
- Uniqueness is provider + country + region + city + query within one `SearchPlan`.
- Use the existing PostgreSQL/pg-boss infrastructure and exact dependency set unless a required build fix proves otherwise.

---

### Task 1: Persist SearchPlan and SearchTask

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260901110000_search_planner/migration.sql`
- Modify: `packages/database/src/index.ts`
- Create: `apps/worker/test/search-plan-persistence.integration.test.ts`

**Interfaces:**
- Produces: Prisma models `SearchPlan`, `SearchTask` and enum `SearchTaskStatus`.
- Produces: exported runtime enum `SearchTaskStatus` from `@ai-crm/database`.
- SearchTask defaults: `PENDING`, zero counters.

- [ ] **Step 1: enable CI for the M3 branch and write the failing persistence test**

The test creates a workspace, user, campaign and then calls `database.searchPlan.create(...)` with nested search tasks. It asserts one task can be persisted with:

```ts
{
  country: 'United States',
  region: 'California',
  city: '',
  geographicCell: '',
  query: 'Dentist',
  provider: 'google-places',
}
```

and verifies defaults:

```ts
expect(task.status).toBe('PENDING');
expect(task.attemptCount).toBe(0);
expect(task.resultCount).toBe(0);
expect(task.uniqueBusinessCount).toBe(0);
```

- [ ] **Step 2: run branch CI and verify RED**

Expected failure: generated Prisma client has no `searchPlan` model and/or `SearchTaskStatus` export.

- [ ] **Step 3: add Prisma schema and migration**

Add:

```prisma
enum SearchTaskStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

model SearchPlan {
  id          String       @id @default(uuid()) @db.Uuid
  workspaceId String       @db.Uuid
  campaignId  String       @unique @db.Uuid
  workspace   Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  campaign    Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  tasks       SearchTask[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@index([workspaceId])
}

model SearchTask {
  id                  String           @id @default(uuid()) @db.Uuid
  searchPlanId        String           @db.Uuid
  country             String           @db.VarChar(120)
  region              String           @default("") @db.VarChar(120)
  city                String           @default("") @db.VarChar(120)
  geographicCell      String           @default("") @db.VarChar(160)
  query               String           @db.VarChar(200)
  provider            String           @db.VarChar(80)
  status              SearchTaskStatus @default(PENDING)
  attemptCount        Int              @default(0)
  resultCount         Int              @default(0)
  uniqueBusinessCount Int              @default(0)
  searchPlan          SearchPlan       @relation(fields: [searchPlanId], references: [id], onDelete: Cascade)
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  @@unique([searchPlanId, provider, country, region, city, query])
  @@index([searchPlanId, status])
}
```

Add relations:

```prisma
model Workspace {
  searchPlans SearchPlan[]
}

model Campaign {
  searchPlan SearchPlan?
}
```

The SQL migration must create the enum, both tables, indexes, unique constraint, and cascading foreign keys without relying on `prisma migrate dev`.

Export `SearchTaskStatus` in `packages/database/src/index.ts`.

- [ ] **Step 4: run CI and verify the persistence test plus Prisma validation/migration pass**

Expected: persistence test GREEN; no schema or migration errors.

- [ ] **Step 5: commit**

Commit message: `feat: persist search plans and tasks`.

---

### Task 2: Deterministic niche and geography expansion

**Files:**
- Create: `apps/worker/src/search-planner/niche-expander.ts`
- Create: `apps/worker/src/search-planner/geography.ts`
- Create: `apps/worker/test/niche-expander.test.ts`
- Create: `apps/worker/test/geography.test.ts`

**Interfaces:**
- Produces: `expandNiche(niche: string): string[]`.
- Produces: `GeographicTarget`, `GeographyInput`, `GeographyCatalog`, `DefaultGeographyCatalog`.

- [ ] **Step 1: write failing niche-expansion tests**

Required exact Dentist result:

```ts
[
  'Dentist',
  'Dental Clinic',
  'Family Dentist',
  'Cosmetic Dentist',
  'Orthodontist',
  'Pediatric Dentist',
  'Emergency Dentist',
]
```

Also assert `expandNiche('  Plumber  ')` returns `['Plumber']` and that `dentists` maps to the Dentist set.

- [ ] **Step 2: write failing geography tests**

Assert:

```ts
catalog.expand({ country: 'United States', region: 'CA', city: 'San Diego' })
```

returns exactly one preserved target.

Assert United States country-only expansion contains multiple state-level targets including `California`, `Texas`, `New York`, and `District of Columbia`, with no duplicates.

Assert an unknown country such as `Pakistan` falls back to one country-level target rather than fabricated subdivisions.

- [ ] **Step 3: run CI and verify RED**

Expected: missing `search-planner/niche-expander` and `search-planner/geography` modules.

- [ ] **Step 4: implement the pure modules**

`expandNiche` uses a deterministic alias/expansion registry and case-insensitive dedupe while preserving stable ordering.

`DefaultGeographyCatalog.expand` rules:

```ts
if (input.city) return [explicit target];
if (input.region) return [explicit target];
if (isUnitedStates(input.country)) return US_STATES.map(...);
return [country-level target];
```

The United States list is the 50 states plus District of Columbia. No provider or network dependency is introduced.

- [ ] **Step 5: run CI and verify both unit suites GREEN**

Expected: exact expansion tests pass.

- [ ] **Step 6: commit**

Commit message: `feat: add deterministic search expansion`.

---

### Task 3: Build the idempotent SearchPlanner

**Files:**
- Create: `apps/worker/src/search-planner/search-planner.ts`
- Create: `apps/worker/test/search-planner.integration.test.ts`

**Interfaces:**
- Consumes: `DatabaseClient`, `CampaignStatus`, `expandNiche`, `GeographyCatalog`.
- Produces:

```ts
export interface SearchPlanningInput {
  workspaceId: string;
  campaignId: string;
}

export interface SearchPlanningResult {
  searchPlanId: string | null;
  generatedTaskCount: number;
  insertedTaskCount: number;
  skipped: boolean;
}

export async function planCampaignSearch(
  database: DatabaseClient,
  input: SearchPlanningInput,
  geographyCatalog?: GeographyCatalog,
): Promise<SearchPlanningResult>
```

- [ ] **Step 1: write a failing PostgreSQL integration test for the 10,000-lead Dentist campaign**

Create a real campaign:

```ts
{
  country: 'United States',
  niche: 'Dentist',
  requestedLeadCount: 10_000,
  status: CampaignStatus.PLANNING,
}
```

Call `planCampaignSearch` and assert:

```ts
expect(result.generatedTaskCount).toBeGreaterThan(7);
expect(result.insertedTaskCount).toBe(result.generatedTaskCount);
expect(await database.searchPlan.count({ where: { campaignId } })).toBe(1);
expect(await database.searchTask.count({ where: { searchPlan: { campaignId } } })).toBe(result.generatedTaskCount);
```

Assert every task has provider `google-places`, `PENDING` status and zero counters.

- [ ] **Step 2: add replay/resume assertions to the failing test**

Mark one task:

```ts
{
  status: SearchTaskStatus.COMPLETED,
  attemptCount: 2,
  resultCount: 20,
  uniqueBusinessCount: 17,
}
```

Run the planner again. Assert:

```ts
expect(replay.insertedTaskCount).toBe(0);
expect(totalTaskCountAfterReplay).toBe(totalTaskCountBeforeReplay);
```

and the completed task still has status `COMPLETED` and counters `2/20/17`.

Also assert a `workspaceId`/`campaignId` mismatch rejects and a cancelled campaign returns `skipped: true` with no plan.

- [ ] **Step 3: run CI and verify RED**

Expected: missing `planCampaignSearch` module/function.

- [ ] **Step 4: implement planner search-space generation**

Load campaign with both identifiers:

```ts
const campaign = await database.campaign.findFirst({
  where: { id: input.campaignId, workspaceId: input.workspaceId },
});
```

Behavior:

```ts
if (!campaign) throw new Error('Campaign not found for search planning');
if (campaign.status === CampaignStatus.CANCELLED) return skippedResult;
if (campaign.status === CampaignStatus.DRAFT) throw new Error('Draft campaign cannot be search planned');
```

Generate one task per query/geography target using provider `google-places`, normalize optional geography to empty strings, dedupe by provider/country/region/city/query, then transactionally:

```ts
const plan = await tx.searchPlan.upsert({
  where: { campaignId: campaign.id },
  update: {},
  create: { workspaceId: campaign.workspaceId, campaignId: campaign.id },
});

const inserted = await tx.searchTask.createMany({
  data: tasks.map((task) => ({ searchPlanId: plan.id, ...task })),
  skipDuplicates: true,
});
```

Do not update existing SearchTask records during replay.

- [ ] **Step 5: run CI and verify integration GREEN**

Expected: 10,000-lead test, mismatch, cancellation, and replay-preservation assertions pass.

- [ ] **Step 6: commit**

Commit message: `feat: generate resumable search plans`.

---

### Task 4: Make campaign-plan execute the production planner

**Files:**
- Modify: `apps/worker/src/campaign-plan.processor.ts`
- Modify: `apps/worker/test/campaign-plan.processor.test.ts`
- Modify: `apps/worker/test/pg-boss.integration.test.ts`

**Interfaces:**
- Consumes: `planCampaignSearch(database, { workspaceId, campaignId })`.
- Keeps injected `CampaignPlanTask` seam for unit tests.
- Production invocation without injected task performs real database planning.

- [ ] **Step 1: write failing processor behavior test**

Keep the payload validation test and verify an injected task still receives only the identifier payload.

Add a default-path test using a minimal database mock where the planner-visible Prisma methods are supplied; expected result is that production processing attempts search planning rather than silently completing a no-op.

- [ ] **Step 2: strengthen the real pg-boss integration test**

Replace the M2 synthetic `randomUUID()` campaign-plan payload test with a real persisted `PLANNING` campaign. Stop the producer after enqueue, start an independent worker, call:

```ts
processCampaignPlanJob(database, job)
```

without injecting a task, wait for `JobMetadata.status === 'COMPLETED'`, then assert a `SearchPlan` and multiple `SearchTask` rows exist for the campaign.

Keep the identifier-only payload assertion by reading the pg-boss work callback job data or by asserting the processor's injected seam in the unit test.

- [ ] **Step 3: run CI and verify RED**

Expected: current production default is a no-op, so persisted search-plan assertions fail.

- [ ] **Step 4: wire the default planner**

Change the processor to:

```ts
const handler = task ?? ((payload: CampaignPlanPayload) =>
  planCampaignSearch(database, {
    workspaceId: payload.workspaceId,
    campaignId: payload.campaignId,
  }));

await handler(payload);
```

Keep `processTrackedJob` as the outer lifecycle wrapper so planner errors still drive pg-boss retries and JobMetadata failures.

- [ ] **Step 5: run CI and verify worker unit/integration suites GREEN**

Expected: independent worker creates search space; M1 retry/durability tests remain green.

- [ ] **Step 6: commit**

Commit message: `feat: execute campaign search planning`.

---

### Task 5: Documentation, scope review, and merge gate

**Files:**
- Modify: `README.md`
- Review: complete diff from `main` to M3 head.

**Interfaces:**
- README documents SearchPlan/SearchTask, deterministic expansion, resumability, worker flow, and the M3/M4 boundary.

- [ ] **Step 1: update README**

Document:

- M3 Search Planner is implemented.
- campaign start → `campaign-plan` → persisted search plan/tasks.
- task status/counters and uniqueness.
- United States state-level geography catalog plus fallback behavior.
- Dentist deterministic expansion.
- provider `google-places` is only an identifier in M3.
- M4 owns real business discovery, pagination, candidate normalization/storage, and provider integrations.

- [ ] **Step 2: run exact-head full CI**

Required successful steps:

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

- [ ] **Step 3: perform final code review against `main`**

Check:

- no Redis/BullMQ/RabbitMQ/Kafka/Temporal.
- no provider SDK or network discovery code.
- no M4 candidate/enrichment logic.
- planner replay preserves existing task state/counters.
- composite uniqueness is database-enforced.
- queue payload remains identifiers only.
- changed-file set is confined to M3 and its CI/docs/test support.

Fix all Critical/Important findings and rerun exact-head CI after any change.

- [ ] **Step 4: create PR and require PR CI on the exact reviewed head**

PR title: `Milestone 3: Search planner`.

Use the exact reviewed branch SHA as the merge guard.

- [ ] **Step 5: squash-merge after PR CI succeeds**

Merge method: squash.

- [ ] **Step 6: verify post-merge `main` CI**

Do not call M3 complete until the workflow triggered by the merge commit on `main` succeeds through migrations, tests, typecheck, lint, build, and compiled smoke-start.
