# AI Lead Intelligence CRM

Autonomous AI Lead Intelligence & Sales CRM.

The repository currently completes **Milestone 1 — PostgreSQL Job System** on top of the authenticated multi-tenant foundation from Milestone 0. Campaign models, lead discovery, crawling, enrichment, AI research, and outreach generation business logic remain intentionally outside this milestone.

## Architecture

```text
apps/
  web/       Next.js + React + TypeScript + Tailwind + TanStack Query
  api/       NestJS API, authentication, workspaces, job scheduling/status
  worker/    Independent pg-boss worker process

packages/
  database/  Prisma + PostgreSQL client and migrations
  queue/     QueueService contract + PgBossQueueService adapter
  shared/    Shared application types
  config/    Zod environment validation
  schemas/   Shared request schemas
```

No Redis, BullMQ, RabbitMQ, Kafka, or Temporal is used. PostgreSQL is the durable store for both application data and pg-boss jobs.

## Prerequisites

- Node.js 24+
- pnpm 11.24+
- Docker with Docker Compose

## Local setup

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:deploy
pnpm build
```

Start the processes independently in separate terminals:

```bash
pnpm start:api
pnpm start:worker
pnpm start:web
```

The web application is available at `http://localhost:3000` and the API at `http://localhost:4000`.

## Authentication and tenancy

- Passwords are hashed with Argon2.
- Login sessions use opaque random bearer tokens; only SHA-256 token hashes are persisted.
- Every registered user starts with a workspace and an `OWNER` membership.
- Workspace-scoped API access is authorized through `WorkspaceMember` on the backend.
- Jobs cannot be scheduled or read merely by supplying another workspace ID.

## PostgreSQL job system

Application code depends on the `QueueService` abstraction rather than calling pg-boss directly. `PgBossQueueService` implements:

- `enqueue()`
- `enqueueBulk()`
- `cancel()`
- `retry()`
- `schedule()`
- `getStatus()`

Milestone 1 defines these durable queues:

```text
system-test
campaign-plan
campaign-discovery
business-enrichment
website-crawl
business-research
outreach-generation
```

Each application queue has a corresponding `-dlq` dead-letter queue. Queue definitions centralize concurrency, retry limits, exponential backoff, retry delay caps, expiration, retention, heartbeat, and dead-letter settings. Priority can be supplied per job.

Queue payloads carry identifiers only. The M1 `system-test` payload contains the workspace ID plus the correlated job ID; later milestones should pass entity IDs rather than embedding scraped pages or other large datasets in queue messages.

### Durable metadata and idempotency

`JobMetadata` projects application-visible job state into PostgreSQL:

```text
jobId
queue
status
workspaceId
attempts
createdAt
startedAt
finishedAt
failureReason
```

An internal workspace-scoped idempotency key is also persisted with a unique database constraint. A caller-supplied idempotency key makes duplicate scheduling return the already-reserved job instead of creating another executable job. If a key is omitted from `/jobs/test`, the API generates a fresh key so intentional repeated test jobs remain possible.

The metadata row is reserved before publishing to pg-boss. If publication fails, the reservation is removed. The same UUID is used as the application job ID, pg-boss job ID, payload correlation ID, and status lookup ID.

### Jobs API

Both endpoints require the normal bearer session token.

Schedule a test job:

```http
POST /jobs/test
Content-Type: application/json
Authorization: Bearer <token>

{
  "workspaceId": "<workspace-uuid>",
  "idempotencyKey": "optional-client-request-key"
}
```

Successful scheduling returns HTTP `202 Accepted` with the job metadata projection.

Read job status:

```http
GET /jobs/<job-uuid>
Authorization: Bearer <token>
```

The API verifies membership in the job's workspace before returning status.

### Worker behavior

`apps/worker` is a separate process. It opens its own pg-boss instance, registers workers using the concurrency configured in the queue catalog, and currently processes only `system-test` jobs.

For each attempt the processor records `RUNNING` and increments `attempts`. A successful attempt records `COMPLETED`; a failed attempt records `FAILED` with `failureReason` and then rethrows so pg-boss owns retry/backoff and eventual dead-letter behavior.

Stopping or restarting the API does not own or erase queued jobs. A separately started worker can consume jobs already persisted in PostgreSQL.

## Environment variables

```text
DATABASE_URL
APP_URL
API_URL
NEXT_PUBLIC_API_URL
NODE_ENV
OPENAI_API_KEY
```

`OPENAI_API_KEY` remains optional and unused in Milestone 1.

## Database commands

```bash
pnpm db:validate
pnpm db:migrate
pnpm db:deploy
pnpm db:down
```

## Verification

Run all repository checks:

```bash
pnpm verify
```

CI starts PostgreSQL, installs from the frozen lockfile, validates and applies Prisma migrations, runs unit and database-backed integration tests, typechecks, lints, builds, and smoke-starts the compiled API, worker, and web applications independently.

The M1 PostgreSQL integration coverage verifies that:

- a queued job survives the producer being stopped and is completed by a separately started worker;
- duplicate scheduling with the same workspace-scoped idempotency key produces one persisted job;
- failed attempts are retried and attempt counts are persisted;
- terminal failures remain visible with their failure reason after retries are exhausted.

## Milestone boundary

Milestone 1 ends with durable asynchronous job infrastructure. The named future queues exist as infrastructure boundaries, but campaign planning, campaign/lead models, Google Business discovery, enrichment, crawling, AI research, and outreach generation are **not** implemented here. Those belong to Milestone 2 and later milestones.
