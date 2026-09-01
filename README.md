# AI Lead Intelligence CRM

Autonomous AI Lead Intelligence & Sales CRM.

The repository currently completes **Milestone 2 — Campaign Management** on top of the authenticated multi-tenant foundation from Milestone 0 and the PostgreSQL job system from Milestone 1. Users can persist workspace-scoped campaigns, control their lifecycle, and hand campaign planning durably to an independent worker. Google Business discovery, enrichment, crawling, AI research, outreach generation, provider integrations, SSE progress, and campaign result tables remain intentionally outside this milestone.

## Architecture

```text
apps/
  web/       Next.js + React + TypeScript + Tailwind + TanStack Query
  api/       NestJS API, authentication, workspaces, campaigns, job scheduling/status
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
- Campaign and job access cannot be gained merely by supplying another workspace ID.

## Campaign management

`Campaign` is persisted in PostgreSQL with:

```text
id
workspaceId
createdByUserId
name
country
region (optional)
city (optional)
niche
requestedLeadCount
status
createdAt
updatedAt
```

`requestedLeadCount` must be a positive integer and Milestone 2 does not impose an arbitrary small product cap.

Campaign status is one of:

```text
DRAFT
PLANNING
PAUSED
CANCELLED
```

Lifecycle transitions are enforced centrally in `CampaignsService` with conditional database updates so stale or concurrent transitions cannot both succeed:

```text
DRAFT -> PLANNING
PLANNING -> PAUSED
PAUSED -> PLANNING
DRAFT | PLANNING | PAUSED -> CANCELLED
```

Invalid or stale transitions return HTTP `409 Conflict`. Every campaign create/read/list/lifecycle operation verifies workspace membership on the backend.

### Campaign API

All endpoints require the normal bearer session token.

```http
POST /campaigns
GET /campaigns?workspaceId=<workspace-uuid>
GET /campaigns/<campaign-uuid>
POST /campaigns/<campaign-uuid>/start
POST /campaigns/<campaign-uuid>/pause
POST /campaigns/<campaign-uuid>/resume
POST /campaigns/<campaign-uuid>/cancel
```

Starting a `DRAFT` campaign atomically moves it to `PLANNING` and schedules one idempotent `campaign-plan` job with the key `campaign-plan:<campaignId>`. The queue payload contains identifiers only: `workspaceId`, `campaignId`, and the correlated `jobId` added by the queue adapter. If publication fails before the job is accepted, the campaign is conditionally restored to `DRAFT` and the error is surfaced.

Pausing and resuming only update the campaign lifecycle in Milestone 2. Resume does not create another planning job because actual discovery execution has not been implemented yet.

### Campaign web routes

The Next.js application adds:

```text
/campaigns
/campaigns/new
/campaigns/[id]
```

These routes reuse the existing browser API client, stored bearer session, selected workspace, and TanStack Query setup. The list displays campaign targeting, requested lead count, and status. The create route captures campaign targeting fields. The detail route displays the current state and only shows lifecycle actions valid for that state.

## PostgreSQL job system

Application code depends on the `QueueService` abstraction rather than calling pg-boss directly. `PgBossQueueService` implements:

- `enqueue()`
- `enqueueBulk()`
- `cancel()`
- `retry()`
- `schedule()`
- `getStatus()`

The durable queue catalog is:

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

Queue payloads carry identifiers and small control fields only. Large scraped pages, research documents, or business datasets belong in PostgreSQL/object storage and should be referenced by ID rather than embedded in queue messages.

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

An internal workspace-scoped idempotency key is also persisted with a unique database constraint. A caller-supplied idempotency key makes duplicate scheduling return the already-reserved job instead of creating another executable job.

The metadata row is reserved before publishing to pg-boss. If publication fails, the reservation is removed. The same UUID is used as the application job ID, pg-boss job ID, payload correlation ID, and status lookup ID.

### Jobs API

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

`apps/worker` is a separate process with its own PostgreSQL/pg-boss lifecycle. It currently registers consumers for `system-test` and `campaign-plan`.

Both processors run through the tracked-job execution wrapper. Each attempt records `RUNNING` and increments `attempts`; success records `COMPLETED`; failure records `FAILED` with `failureReason` and rethrows so pg-boss owns retry/backoff and eventual dead-letter behavior.

The `campaign-plan` domain handler is intentionally a no-op in Milestone 2. Its purpose is to prove the durable API-to-worker handoff and tracked job lifecycle without prematurely implementing discovery.

Stopping or restarting the API/producer does not erase queued jobs. A separately started worker can consume planning work already persisted in PostgreSQL.

## Environment variables

```text
DATABASE_URL
APP_URL
API_URL
NEXT_PUBLIC_API_URL
NODE_ENV
OPENAI_API_KEY
```

`OPENAI_API_KEY` remains optional and unused in Milestone 2.

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

Current PostgreSQL-backed coverage verifies that:

- campaign targeting, ownership, a large requested-lead target, and the `DRAFT` default persist correctly;
- a queued job survives the producer being stopped and is completed by a separately started worker;
- a `campaign-plan` job survives producer shutdown and is consumed by an independent worker using identifier-only payload data;
- duplicate scheduling with the same workspace-scoped idempotency key produces one persisted job;
- failed attempts are retried and attempt counts are persisted;
- terminal failures remain visible with their failure reason after retries are exhausted.

API/service tests additionally cover workspace isolation, campaign lifecycle conflicts, start idempotency, queue payload shape, and rollback when queue publication fails. Frontend tests cover campaign geography formatting and valid lifecycle-action visibility.

## Milestone boundary

Milestone 2 ends with production campaign persistence, workspace-isolated campaign APIs/UI, lifecycle control, and a durable `campaign-plan` worker handoff. The later queue names already exist as infrastructure boundaries, but Google Business discovery, lead/business result models, enrichment, website crawling, AI research, outreach generation, provider integrations, SSE progress streaming, and autonomous campaign execution are **not** implemented yet.
