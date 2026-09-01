# Milestone 1 — PostgreSQL Job System Design

## Scope

Milestone 1 adds durable asynchronous job execution before any campaign or lead-discovery behavior. PostgreSQL remains the only infrastructure dependency. `pg-boss` owns durable queue execution state; Prisma owns the application-visible `JobMetadata` projection used by the API and future UI.

Out of scope: Campaign/Lead models, Google Business discovery, crawling, AI research, outreach generation, SSE progress streaming, Redis/BullMQ/RabbitMQ/Kafka/Temporal.

## Constraints

- Use `pg-boss` only for background jobs.
- Run API and worker as independent processes.
- Jobs must survive API and worker restarts.
- Queue payloads contain identifiers and small control metadata only; never business datasets or scraped page bodies.
- All workspace-scoped jobs are authorized before enqueue.
- Duplicate scheduling with the same idempotency key must be safe.
- Retries use exponential backoff and bounded attempts.
- Failed jobs remain inspectable through `JobMetadata` and pg-boss retention.
- No M2+ business functionality is introduced.

## Selected architecture

### Queue abstraction

`packages/queue` exports a `QueueService` contract with:

- `enqueue()`
- `enqueueBulk()`
- `cancel()`
- `retry()`
- `schedule()`
- `getStatus()`

`PgBossQueueService` implements that contract and additionally owns adapter lifecycle (`start`, `stop`, queue registration, worker registration). API and worker depend on the package, not on raw pg-boss calls.

Alternative 1 — call pg-boss directly from API and worker — is rejected because it spreads retry/idempotency/queue defaults across applications.

Alternative 2 — use a separate broker/database — is rejected because the product explicitly standardizes initial async infrastructure on PostgreSQL + pg-boss.

## pg-boss version

Pin `pg-boss` to `12.28.0`. The npm `latest` tag is currently 12.28.1, but 12.28.1 was published only about one day before this milestone. The repository already uses pnpm release-age protections, so 12.28.0 is the newest stable version old enough to avoid bypassing that supply-chain policy.

pg-boss 12 requires Node >=22.12 and PostgreSQL >=13; this repository already targets Node >=24 and PostgreSQL 17.

## Queue catalog

Application queues:

- `system-test`
- `campaign-plan`
- `campaign-discovery`
- `business-enrichment`
- `website-crawl`
- `business-research`
- `outreach-generation`

Each application queue receives a private dead-letter queue named `<queue>-dlq`. DLQs are infrastructure queues, not application work queues.

Default queue policy:

- policy: `standard`
- retryLimit: 3
- retryDelay: 5 seconds
- retryBackoff: true
- retryDelayMax: 300 seconds
- expireInSeconds: 900 seconds
- retentionSeconds: 14 days
- deleteAfterSeconds: 7 days
- heartbeatSeconds: 60 seconds
- deadLetter: `<queue>-dlq`

The defaults are conservative for M1 and may be overridden by later queue-specific requirements.

## Idempotency

Every enqueue request may include an `idempotencyKey`. `PgBossQueueService` maps it to pg-boss `singletonKey`.

If pg-boss rejects a duplicate send by returning `null`, the adapter queries `findJobs(queue, { key: idempotencyKey })` and returns the existing job id/status instead of creating duplicate metadata. This makes repeated API requests safe while the same keyed job is queued/active/retrying.

The test endpoint generates an idempotency key when the caller omits one so normal calls still create independent jobs.

## Payload contract

M1 job payloads use a shared shape:

```ts
interface QueuePayload {
  jobId: string;
  workspaceId: string;
}
```

Future milestones may add other identifiers (for example campaignId or businessId), but must not place large datasets into queue payloads.

## Application job metadata

Prisma adds:

```text
JobStatus = QUEUED | RUNNING | COMPLETED | FAILED | CANCELLED

JobMetadata
  jobId           UUID primary key
  queue           varchar
  status          JobStatus
  workspaceId     UUID
  attempts        integer default 0
  createdAt       timestamp
  startedAt       timestamp nullable
  finishedAt      timestamp nullable
  failureReason   text nullable
```

`workspaceId` has a foreign key to `Workspace` with cascade deletion and indexes on workspace/status/queue.

The pg-boss UUID is the `JobMetadata.jobId`, keeping one stable identifier across API, metadata, logs, and worker processing.

## Enqueue flow

1. API authenticates the user.
2. API verifies membership in the target workspace.
3. API creates/sends the pg-boss job through `QueueService` using only ids in the payload.
4. Queue service creates `JobMetadata` as `QUEUED` for newly accepted jobs.
5. Duplicate keyed sends return the existing job metadata.
6. API responds with the metadata record.

For M1, queue and metadata writes are not forced into the same database transaction because the public adapter API must remain usable outside Prisma transactions. The enqueue implementation compensates by cancelling a newly sent job if metadata creation fails. A future milestone may use pg-boss's Prisma transaction adapter where atomic business-write + enqueue is required.

## Worker flow

1. Worker creates Prisma and pg-boss clients from `DATABASE_URL`.
2. Worker starts pg-boss and ensures all queues/DLQs exist.
3. Worker registers a `system-test` handler.
4. On pickup, metadata becomes `RUNNING`, `attempts` increments, and `startedAt` is set on first attempt.
5. Handler executes.
6. Success sets metadata to `COMPLETED`, clears `failureReason`, and sets `finishedAt`.
7. Handler error stores the latest failure reason and rethrows so pg-boss performs retry/backoff.
8. A completion/reconciliation callback maps terminal pg-boss failures to metadata `FAILED` with `finishedAt`.

For queues whose business processors do not exist yet, M1 registers the queue definitions but no handlers.

## Queue controls

- `cancel(queue, jobId)` calls pg-boss cancel and updates metadata to `CANCELLED`.
- `retry(queue, jobId)` retries a failed pg-boss job and resets metadata to `QUEUED`, preserving attempt history.
- `schedule(queue, payload, runAt, options)` sends the job with `startAfter`.
- `getStatus(queue, jobId)` reads application metadata first and can reconcile with pg-boss `findJobs()` when needed.
- `enqueueBulk()` inserts jobs sequentially in M1 through the same safe enqueue path so idempotency and metadata semantics remain identical. A later performance milestone can optimize with pg-boss bulk insert after proving equivalent semantics.

## API vertical slice

`POST /jobs/test`

Authenticated request body:

```json
{
  "workspaceId": "uuid",
  "idempotencyKey": "optional-string"
}
```

Behavior:

- verify caller belongs to `workspaceId`
- enqueue a `system-test` job
- return `202 Accepted` with `JobMetadata`

`GET /jobs/:jobId` is included as the minimal visibility endpoint required to observe completion/failure. It verifies that the authenticated user belongs to the job's workspace.

No generic production enqueue endpoint is exposed in M1.

## Failure visibility and DLQ behavior

Every application queue dead-letters permanently failed jobs into its `<queue>-dlq`. Job metadata remains `FAILED` after retries are exhausted. pg-boss retains terminal jobs for seven days by default; application metadata remains until its workspace is deleted.

Future admin tooling can redrive DLQs with pg-boss `redrive()`, but M1 exposes retry only for an individual failed source job through the queue service, not through a public API.

## Testing strategy

### Unit tests

- queue catalog contains every required queue and DLQ configuration
- enqueue maps retry/priority/expiration/idempotency options correctly
- duplicate singleton enqueue resolves the existing job
- cancel/retry/schedule/getStatus delegate correctly
- worker processor updates running/completed/failed attempt metadata
- jobs controller enforces workspace membership

### PostgreSQL integration tests

- API-created `system-test` job is persisted in PostgreSQL
- producer can disconnect after enqueue and a newly started worker still processes the job
- duplicate idempotency key produces one underlying queued job / one metadata record
- retrying handler failures increments attempts and eventually completes or fails
- permanent failure remains visible as `FAILED`

### CI acceptance

The existing CI PostgreSQL service runs Prisma migration, tests, typecheck, lint, build, and compiled process smoke tests. M1 extends smoke verification so the worker starts pg-boss successfully and remains independent of the API process.
