# Milestone 2 Campaign Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build workspace-scoped campaign persistence, lifecycle APIs, durable `campaign-plan` scheduling, a worker handoff, and basic campaign UI routes.

**Architecture:** Extend the existing Prisma domain with Campaign, keep authorization/lifecycle rules in a Nest `CampaignsService`, call only the M1 `QueueService` abstraction for async work, and reuse the worker tracked-job wrapper. Frontend routes reuse the existing session and TanStack Query patterns.

**Tech Stack:** Next.js, React, TypeScript, NestJS, PostgreSQL, Prisma, pg-boss via `@ai-crm/queue`, Zod, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-milestone-2-campaign-management-design.md`

## Global Constraints

- Do not add Redis, BullMQ, RabbitMQ, Kafka, or Temporal.
- Queue payloads contain IDs/small control fields only.
- `requestedLeadCount` must be a positive integer with no arbitrary small product cap.
- Every campaign read/write must enforce workspace membership.
- Invalid or stale lifecycle transitions return HTTP 409.
- M2 does not implement discovery, enrichment, crawling, AI research, outreach, or SSE.
- Follow TDD and keep commits scoped to independently reviewable slices.

---

### Task 1: Campaign Validation and Persistence

**Files:**
- Modify: `packages/schemas/src/index.ts`
- Create: `packages/schemas/test/campaigns.test.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260901100000_campaign_management/migration.sql`
- Modify: `packages/database/src/index.ts`
- Create: `apps/api/test/campaign-persistence.integration.test.ts`

**Interfaces:**
- Produces `createCampaignSchema` and `CreateCampaignInput`.
- Produces Prisma `CampaignStatus` and `Campaign` model.

- [ ] **Step 1: Write failing schema tests**

Test that a valid campaign parses, `requestedLeadCount: 0` fails, fractional counts fail, and blank optional region/city normalize away.

```ts
const parsed = createCampaignSchema.parse({
  workspaceId,
  name: 'Oslo Dentists',
  country: 'Norway',
  region: '',
  city: 'Oslo',
  niche: 'Dentist',
  requestedLeadCount: 25000,
});
expect(parsed.region).toBeUndefined();
expect(parsed.requestedLeadCount).toBe(25000);
```

- [ ] **Step 2: Run schema test and verify RED**

Run `pnpm --filter @ai-crm/schemas test -- campaigns.test.ts`.
Expected: failure because `createCampaignSchema` is not exported.

- [ ] **Step 3: Implement campaign Zod schema**

Use trimmed bounded strings, `z.uuid()`, `z.number().int().min(1)`, and a preprocess/transform for optional blank strings.

- [ ] **Step 4: Write failing persistence integration test**

Create a real user/workspace/campaign and assert default `DRAFT`, persisted targeting fields, creator relation, and `requestedLeadCount: 25000`.

- [ ] **Step 5: Add Prisma enum/model/migration**

Add `CampaignStatus { DRAFT PLANNING PAUSED CANCELLED }`; add Workspace/User relations and indexed Campaign fields exactly as specified.

- [ ] **Step 6: Run migration/schema/integration test GREEN**

Run Prisma validate/deploy and API integration test under CI PostgreSQL.

- [ ] **Step 7: Commit**

Commit message: `feat: add campaign persistence and validation`.

---

### Task 2: Campaign Service and Lifecycle

**Files:**
- Create: `apps/api/src/campaigns/campaigns.service.ts`
- Create: `apps/api/test/campaigns.service.test.ts`

**Interfaces:**
- Consumes `DatabaseClient`, `QueueService`, `CreateCampaignInput`.
- Produces `create`, `list`, `get`, `start`, `pause`, `resume`, `cancel` methods.

- [ ] **Step 1: Write failing service tests**

Cover member/non-member create, workspace-filtered list, inaccessible detail, valid transitions, conflict transitions, start payload `{ workspaceId, campaignId }`, idempotency key `campaign-plan:<campaignId>`, and rollback to `DRAFT` when enqueue throws.

- [ ] **Step 2: Run service test RED**

Run `pnpm --filter @ai-crm/api test -- campaigns.service.test.ts`.
Expected: module missing.

- [ ] **Step 3: Implement membership + CRUD helpers**

Use `workspaceMember.findUnique({ where: { workspaceId_userId } })`; return 403 when absent and 404 for missing campaign IDs.

- [ ] **Step 4: Implement atomic lifecycle helper**

Use `campaign.updateMany({ where: { id, workspaceId, status: expected }, data: { status: next } })`; require count 1 or throw `ConflictException`.

- [ ] **Step 5: Implement start queue handoff**

Transition DRAFT->PLANNING, enqueue `campaign-plan` with identifier-only payload and deterministic campaign key; on enqueue error conditionally roll PLANNING->DRAFT and rethrow.

- [ ] **Step 6: Run service tests GREEN**

Run the focused service suite.

- [ ] **Step 7: Commit**

Commit message: `feat: add campaign lifecycle service`.

---

### Task 3: Campaign API Module

**Files:**
- Create: `apps/api/src/campaigns/campaigns.controller.ts`
- Create: `apps/api/src/campaigns/campaigns.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/campaigns.controller.test.ts`

**Interfaces:**
- Exposes authenticated REST routes:
  - `POST /campaigns`
  - `GET /campaigns?workspaceId=`
  - `GET /campaigns/:campaignId`
  - `POST /campaigns/:campaignId/start`
  - `POST /campaigns/:campaignId/pause`
  - `POST /campaigns/:campaignId/resume`
  - `POST /campaigns/:campaignId/cancel`

- [ ] **Step 1: Write failing controller tests**

Instantiate controller with a mocked service and assert each route delegates authenticated `CurrentUser.id` plus parsed inputs/params.

- [ ] **Step 2: Run controller tests RED**

Expected: controller/module missing.

- [ ] **Step 3: Implement controller**

Apply `@UseGuards(AuthGuard)`, `parseWithSchema` for body/query validation, `@HttpCode(202)` for start, and standard 200/201 semantics elsewhere.

- [ ] **Step 4: Register module in AppModule**

Provide `CampaignsService`; reuse `JobsModule` exported `QueueProvider` or export the queue provider cleanly if required so CampaignsService still depends only on `QueueService` structurally.

- [ ] **Step 5: Run controller/API tests GREEN**

Run API unit and integration suites.

- [ ] **Step 6: Commit**

Commit message: `feat: expose campaign management api`.

---

### Task 4: Campaign Plan Worker Handoff

**Files:**
- Modify: `packages/queue/src/types.ts` only if worker payload typing needs `campaignId` support (keep small string fields).
- Create: `apps/worker/src/processors/campaign-plan.processor.ts`
- Modify: `apps/worker/src/lifecycle.ts`
- Create: `apps/worker/test/campaign-plan.processor.test.ts`
- Modify: `apps/worker/test/pg-boss.integration.test.ts`

**Interfaces:**
- Worker consumes queue `campaign-plan` payload `{ jobId, workspaceId, campaignId }`.
- Reuses `processTrackedJob` so JobMetadata records RUNNING/attempts/COMPLETED/FAILED.

- [ ] **Step 1: Write failing processor/registration tests**

Assert the campaign processor accepts identifier payload and the lifecycle registers `campaign-plan` alongside `system-test`.

- [ ] **Step 2: Run RED worker tests**

Expected: processor missing/queue registration absent.

- [ ] **Step 3: Implement no-op domain processor**

Delegate through the tracked-job wrapper and intentionally perform no discovery.

- [ ] **Step 4: Add real PostgreSQL handoff acceptance test**

Enqueue `campaign-plan`, stop producer, start independent worker lifecycle/consumer, poll metadata until COMPLETED, and assert payload contains only IDs.

- [ ] **Step 5: Run worker tests GREEN**

Run worker unit + PostgreSQL integration suite.

- [ ] **Step 6: Commit**

Commit message: `feat: process campaign planning jobs`.

---

### Task 5: Campaign Frontend Routes

**Files:**
- Create: `apps/web/lib/campaigns.ts`
- Create: `apps/web/test/campaigns.test.ts`
- Create: `apps/web/app/campaigns/page.tsx`
- Create: `apps/web/app/campaigns/new/page.tsx`
- Create: `apps/web/app/campaigns/[id]/page.tsx`
- Modify: `apps/web/app/dashboard/page.tsx`

**Interfaces:**
- Produces campaign response/type helpers and lifecycle-action visibility helper.
- Uses existing `createBrowserApiClient`, `getSessionToken`, `getSelectedWorkspaceId`, router, and TanStack Query.

- [ ] **Step 1: Write failing frontend helper tests**

Test geography formatting and valid action visibility by status:
`DRAFT => start,cancel`; `PLANNING => pause,cancel`; `PAUSED => resume,cancel`; `CANCELLED => none`.

- [ ] **Step 2: Run web test RED**

Expected: campaigns helper missing.

- [ ] **Step 3: Implement helper/types**

Keep types aligned with API Campaign fields and no duplicated lifecycle business transition implementation beyond button visibility.

- [ ] **Step 4: Implement list route**

Hydrate token/workspace from existing storage, redirect to login if unauthenticated, fetch workspace campaign list, render status/targeting/count, link create/detail.

- [ ] **Step 5: Implement create route**

Controlled form for approved fields; convert lead count to number; POST then route to detail.

- [ ] **Step 6: Implement detail route**

Fetch campaign, render lifecycle buttons per helper, POST action endpoints, invalidate list/detail queries after success.

- [ ] **Step 7: Update dashboard navigation/copy**

Add a Campaigns link and replace the stale M0-only campaigns-future copy.

- [ ] **Step 8: Run web tests/typecheck/build**

Confirm all three routes compile.

- [ ] **Step 9: Commit**

Commit message: `feat: add campaign management ui`.

---

### Task 6: Milestone 2 Acceptance and Merge Gate

**Files:**
- Modify: `README.md` with M2 behavior and routes.
- Modify: `.github/workflows/ci.yml` to include the M2 feature branch while it is active if branch-trigger filtering requires it.

**Interfaces:**
- Produces a frozen merge candidate with no temporary write workflows.

- [ ] **Step 1: Add/update CI branch trigger if needed**

Ensure pushes to `feat/milestone-2-campaign-management` run the same PostgreSQL verification job as main.

- [ ] **Step 2: Run full CI on exact candidate SHA**

Required green steps: frozen install, Prisma validate, migrations, all tests including PostgreSQL campaign-plan handoff, typecheck, lint, build, compiled smoke.

- [ ] **Step 3: Review diff against spec**

Verify no discovery/provider implementation slipped into M2, no forbidden broker dependency was added, queue payloads contain identifiers only, and every campaign service operation enforces tenant membership.

- [ ] **Step 4: Open PR and merge only with exact-head guard**

Create `Milestone 2: Campaign management`, squash merge after exact candidate CI is green.

- [ ] **Step 5: Verify post-merge main CI**

Require the push-triggered run on the squash commit to pass all gates before declaring M2 complete.
