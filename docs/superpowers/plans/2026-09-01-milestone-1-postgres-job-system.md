# Milestone 1 — PostgreSQL Job System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready PostgreSQL-backed job system using pg-boss, with durable execution, retries, idempotency, job metadata, an independent worker, and a `/jobs/test` vertical slice.

**Architecture:** `packages/queue` owns the queue contract and pg-boss adapter. Prisma stores application-visible `JobMetadata`; pg-boss stores execution state in PostgreSQL. The NestJS API enqueues authorized workspace jobs, while the standalone worker consumes `system-test` and updates metadata.

**Tech Stack:** TypeScript 6, Node 24, PostgreSQL 17, Prisma 7.10, pg-boss 12.28.0, NestJS 12, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-milestone-1-postgres-job-system-design.md`

## Global Constraints

- PostgreSQL + pg-boss is the only background-job infrastructure.
- Do not introduce Redis, BullMQ, RabbitMQ, Kafka, or Temporal.
- Job payloads contain identifiers and small control metadata only.
- API and worker remain independently runnable processes.
- M1 must not add campaign/lead discovery behavior.
- All production behavior is implemented test-first.
- Dependency `pg-boss` is pinned to `12.28.0`.

---

### Task 1: Queue contract and queue catalog

**Files:**
- Modify: `packages/queue/package.json`
- Create: `packages/queue/tsconfig.json`
- Create: `packages/queue/tsconfig.build.json`
- Create: `packages/queue/src/types.ts`
- Create: `packages/queue/src/queues.ts`
- Create: `packages/queue/src/index.ts`
- Create: `packages/queue/test/queues.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `QueueName`, `QueuePayload`, `EnqueueOptions`, `QueueJobStatus`, `QueueJobResult`, `QueueService`.
- Produces `APPLICATION_QUEUES`, `queueDefinitions`, `deadLetterQueueName()`.

- [ ] **Step 1: Write the failing catalog test**

```ts
import { describe, expect, it } from 'vitest';
import { APPLICATION_QUEUES, queueDefinitions } from '../src/queues.js';

describe('queue catalog', () => {
  it('defines every milestone queue with retry, expiry, heartbeat, and dead-letter defaults', () => {
    expect(APPLICATION_QUEUES).toEqual([
      'system-test',
      'campaign-plan',
      'campaign-discovery',
      'business-enrichment',
      'website-crawl',
      'business-research',
      'outreach-generation',
    ]);

    for (const queue of queueDefinitions) {
      expect(queue.retryLimit).toBe(3);
      expect(queue.retryBackoff).toBe(true);
      expect(queue.expireInSeconds).toBe(900);
      expect(queue.heartbeatSeconds).toBe(60);
      expect(queue.deadLetter).toBe(`${queue.name}-dlq`);
    }
  });
});
```

- [ ] **Step 2: Run the queue test and verify RED**

Run: `pnpm --filter @ai-crm/queue test`
Expected: FAIL because queue package/test implementation does not exist.

- [ ] **Step 3: Implement minimal queue types/catalog**

Define the queue contract exactly as the spec requires and default queue definitions with retry limit 3, retry delay 5s, exponential backoff, max retry delay 300s, expiration 900s, retention 14d, completed retention 7d, heartbeat 60s, and per-queue DLQ.

- [ ] **Step 4: Add queue package to package build ordering and verify GREEN**

Run: `pnpm --filter @ai-crm/queue test && pnpm --filter @ai-crm/queue typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/queue package.json
git commit -m "feat: define postgres queue contract"
```

### Task 2: Persist application job metadata

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260901083000_job_metadata/migration.sql`
- Create: `packages/database/test/job-metadata.test.ts`
- Modify: `packages/database/package.json` only if a test script is missing.

**Interfaces:**
- Produces Prisma `JobStatus` enum and `JobMetadata` model keyed by pg-boss UUID.

- [ ] **Step 1: Write a failing PostgreSQL metadata test**

Test creates a workspace, inserts a `JobMetadata` row with status `QUEUED`, reads it back, and verifies attempts default to 0 and nullable timestamps/failureReason are null.

- [ ] **Step 2: Run test against CI/local PostgreSQL and verify RED**

Run: `DATABASE_URL=... pnpm --filter @ai-crm/database test`
Expected: FAIL because `jobMetadata` Prisma model does not exist.

- [ ] **Step 3: Add Prisma enum/model and SQL migration**

Schema requirements:

```prisma
enum JobStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

model JobMetadata {
  jobId         String    @id @db.Uuid
  queue         String    @db.VarChar(80)
  status        JobStatus @default(QUEUED)
  workspaceId   String    @db.Uuid
  attempts      Int       @default(0)
  createdAt     DateTime  @default(now())
  startedAt     DateTime?
  finishedAt    DateTime?
  failureReason String?
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, status])
  @@index([queue, status])
}
```

Add `jobs JobMetadata[]` to `Workspace`.

- [ ] **Step 4: Generate client, deploy migration, run test and verify GREEN**

Run: `pnpm run db:generate && pnpm run db:deploy && pnpm --filter @ai-crm/database test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "feat: persist job metadata"
```

### Task 3: Implement PgBossQueueService

**Files:**
- Create: `packages/queue/src/pg-boss-queue.service.ts`
- Create: `packages/queue/test/pg-boss-queue.service.test.ts`
- Modify: `packages/queue/src/index.ts`
- Modify: `packages/queue/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes `QueueService`, queue catalog, Prisma client-compatible metadata repository.
- Produces `PgBossQueueService` with `start()`, `stop()`, `ensureQueues()`, `work()`, and the required QueueService methods.

- [ ] **Step 1: Write failing adapter tests**

Cover:
- enqueue maps `idempotencyKey` to `singletonKey`
- duplicate `send()` returning null resolves existing job via `findJobs`
- schedule maps Date to `startAfter`
- cancel calls pg-boss and marks metadata `CANCELLED`
- retry calls pg-boss and resets metadata to `QUEUED`
- getStatus returns metadata
- queue initialization creates DLQ before source queue

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `pnpm --filter @ai-crm/queue test`
Expected: FAIL because `PgBossQueueService` is missing.

- [ ] **Step 3: Add pinned pg-boss dependency and minimal adapter implementation**

Use `new PgBoss({ connectionString: databaseUrl, useListenNotify: true })`. On `start()`, call `boss.start()` then create all DLQs and source queues. `enqueue()` uses `boss.send(queue, payload, options)` and persists metadata for a newly returned job id. If `send()` returns null for a singleton duplicate, call `findJobs(queue, { key: idempotencyKey })` and return the existing metadata.

- [ ] **Step 4: Verify unit GREEN**

Run: `pnpm --filter @ai-crm/queue test && pnpm --filter @ai-crm/queue typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/queue pnpm-lock.yaml
git commit -m "feat: implement pg-boss queue adapter"
```

### Task 4: Add authenticated Jobs API vertical slice

**Files:**
- Create: `apps/api/src/jobs/jobs.module.ts`
- Create: `apps/api/src/jobs/jobs.controller.ts`
- Create: `apps/api/src/jobs/jobs.service.ts`
- Create: `apps/api/src/jobs/queue.provider.ts`
- Create: `apps/api/test/jobs.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/schemas/test/auth.test.ts` or create `packages/schemas/test/jobs.test.ts`

**Interfaces:**
- `POST /jobs/test` body `{ workspaceId: uuid, idempotencyKey?: string }`.
- `GET /jobs/:jobId` returns authorized workspace metadata.

- [ ] **Step 1: Write failing schema and service tests**

Tests prove invalid UUID is rejected, non-member cannot enqueue/view a job, and member enqueue targets `system-test` with a generated idempotency key when omitted.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @ai-crm/schemas test && pnpm --filter @ai-crm/api test`
Expected: FAIL because jobs schemas/module/service do not exist.

- [ ] **Step 3: Implement schemas, queue provider, service, controller, and module**

Queue provider creates/starts one `PgBossQueueService` for the API process and stops it during Nest shutdown. `JobsService` checks `workspaceMember.findUnique({ workspaceId_userId })` before enqueue/read. Controller uses existing `AuthGuard` and `CurrentUser` patterns and returns HTTP 202 for POST.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @ai-crm/schemas test && pnpm --filter @ai-crm/api test && pnpm --filter @ai-crm/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/schemas
git commit -m "feat: add jobs test API"
```

### Task 5: Run system-test jobs in the independent worker

**Files:**
- Create: `apps/worker/src/system-test.processor.ts`
- Create: `apps/worker/src/job-worker.ts`
- Create: `apps/worker/test/system-test.processor.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/lifecycle.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**
- Worker registers `system-test` only.
- Processor updates metadata `RUNNING` -> `COMPLETED`; errors store latest failure and rethrow.

- [ ] **Step 1: Write failing processor test**

Test verifies a processing attempt increments `attempts`, sets `startedAt`, and success sets `COMPLETED`/`finishedAt`. A second test verifies thrown processor error stores `failureReason` and rethrows.

- [ ] **Step 2: Run worker tests and verify RED**

Run: `pnpm --filter @ai-crm/worker test`
Expected: FAIL because processor/queue worker do not exist.

- [ ] **Step 3: Implement worker queue lifecycle and system-test processor**

Start Prisma, then queue service, register `system-test`, log `worker ready`, and on shutdown stop pg-boss before disconnecting Prisma. Keep other M1 queues registered but without handlers.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @ai-crm/worker test && pnpm --filter @ai-crm/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat: process durable system test jobs"
```

### Task 6: Prove durability, retry, idempotency, and failure visibility in PostgreSQL

**Files:**
- Create: `packages/queue/test/pg-boss.integration.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Integration test uses real PostgreSQL and real pg-boss.

- [ ] **Step 1: Write failing real-Postgres integration tests**

Test A: producer starts, enqueues, stops; a fresh consumer instance starts later and completes the same job.

Test B: enqueue same `idempotencyKey` twice before processing and assert the same `jobId` / one metadata row.

Test C: handler fails initial attempts, pg-boss retries with backoff, and metadata attempts increases before eventual completion.

Test D: handler always fails; after retry exhaustion metadata becomes `FAILED` and the source failure remains inspectable.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `DATABASE_URL=... pnpm --filter @ai-crm/queue test`
Expected: at least one acceptance test fails before final reconciliation behavior is implemented.

- [ ] **Step 3: Add minimal terminal-failure reconciliation and CI smoke coverage**

Use pg-boss completion/status events or source job lookup to detect exhausted retries/dead-letter transition and update `JobMetadata` to `FAILED`. Extend compiled smoke test to start worker with pg-boss and confirm `worker ready` while API starts independently.

- [ ] **Step 4: Update README with queue commands/architecture and M1 boundaries**

Document application queues, DLQs, retry defaults, `/jobs/test`, `GET /jobs/:jobId`, and the no-Redis/BullMQ constraint.

- [ ] **Step 5: Run full verification**

Run: `pnpm verify` with PostgreSQL migration deployed.
Expected: tests PASS, typecheck PASS, lint PASS, build PASS.

Then run compiled API/worker/web smoke test from CI.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/queue/test .github/workflows/ci.yml README.md
git commit -m "test: verify durable postgres jobs"
```

### Task 7: Final milestone audit

**Files:**
- Review all M1 changes against the design spec.

- [ ] **Step 1: Confirm forbidden dependencies are absent**

Search lockfile/package manifests for Redis, BullMQ, RabbitMQ, Kafka, and Temporal additions attributable to M1.

- [ ] **Step 2: Confirm payloads contain ids/small control metadata only**

Review every `enqueue` call and queue payload type.

- [ ] **Step 3: Confirm every M1 acceptance criterion has executable evidence**

- jobs survive producer/API restart
- worker runs independently
- retries/backoff execute
- failed jobs are visible
- duplicate scheduling is safe
- test endpoint schedules work
- all required queues exist

- [ ] **Step 4: Run fresh full CI on the final branch head**

Expected: one completed workflow with conclusion `success` on the exact final SHA.
