# AI Lead Intelligence CRM

Autonomous AI Lead Intelligence & Sales CRM.

The repository currently completes **Milestone 3 — Search Planner** on top of the authenticated multi-tenant foundation, durable PostgreSQL job system, and campaign-management domain from Milestones 0–2. Starting a campaign now hands durable planning work to an independent worker, which transforms campaign targeting into a persisted, resumable search space. Real business-discovery provider calls, candidate normalization/storage, enrichment, crawling, AI research, outreach generation, and autonomous campaign execution remain intentionally outside this milestone.

## Architecture

```text
apps/
  web/       Next.js + React + TypeScript + Tailwind + TanStack Query
  api/       NestJS API, authentication, workspaces, campaigns, job scheduling/status
  worker/    Independent pg-boss worker + deterministic search planner

packages/
  database/  Prisma + PostgreSQL client and migrations
  queue/     QueueService contract + PgBossQueueService adapter
  shared/    Shared application types
  config/    Zod environment validation
  schemas/   Shared request schemas
```

No Redis, BullMQ, RabbitMQ, Kafka, or Temporal is used. PostgreSQL is the durable store for application state, search-planning state, and pg-boss jobs.

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
- Search planning loads a campaign by both `campaignId` and `workspaceId`, preserving the same tenant boundary inside the worker.

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

`requestedLeadCount` must be a positive integer; it is a campaign target, not an artificial cap on the number of planning tasks.

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

Starting a `DRAFT` campaign atomically moves it to `PLANNING` and schedules one idempotent `campaign-plan` job with key `campaign-plan:<campaignId>`. The queue payload contains identifiers only: `workspaceId`, `campaignId`, and the correlated `jobId` added by the queue adapter. If publication fails before the job is accepted, the campaign is conditionally restored to `DRAFT` and the error is surfaced.

### Campaign web routes

The Next.js application includes:

```text
/campaigns
/campaigns/new
/campaigns/[id]
```

These routes reuse the existing browser API client, stored bearer session, selected workspace, and TanStack Query setup.

## Search Planner

Milestone 3 turns a campaign target into durable search-space records before any external provider is called.

The flow is:

```text
Campaign start
    ↓
DRAFT -> PLANNING
    ↓
campaign-plan job
    ↓
independent worker
    ↓
deterministic Search Planner
    ↓
SearchPlan + SearchTask rows in PostgreSQL
```

### SearchPlan

There is exactly one `SearchPlan` per campaign. The campaign ID is unique at the database level, so pg-boss retries, worker restarts, or application-level replay reuse the existing plan instead of creating another one.

### SearchTask

Each persisted task contains:

```text
country
region
city
geographicCell
query
provider
status
attemptCount
resultCount
uniqueBusinessCount
```

Task execution status is one of:

```text
PENDING
RUNNING
COMPLETED
FAILED
CANCELLED
```

M3 only creates tasks as `PENDING`; the remaining states and counters are persisted now so M4 discovery work can resume safely later.

The database prevents duplicate search space with a unique constraint on:

```text
searchPlanId + provider + country + region + city + query
```

`region`, `city`, and `geographicCell` are normalized to non-null strings so PostgreSQL uniqueness cannot be bypassed through `NULL` semantics.

Planner replay uses `createMany(..., skipDuplicates: true)` and never updates existing task state or counters. A task already marked `COMPLETED`, including its attempt/result/unique-business counters, stays completed when planning is replayed.

### Deterministic niche expansion

M3 deliberately uses deterministic expansion instead of an LLM. The default `Dentist` search set is:

```text
Dentist
Dental Clinic
Family Dentist
Cosmetic Dentist
Orthodontist
Pediatric Dentist
Emergency Dentist
```

Known aliases such as `dentists` map to the same stable set. An unknown niche falls back to the trimmed niche itself instead of inventing variants.

AI-assisted niche expansion is deferred to a later milestone where model infrastructure, evaluation, and guardrails can be added deliberately.

### Geography abstraction

Geography expansion lives behind `GeographyCatalog`; it is not embedded in `CampaignsService`.

The current deterministic catalog follows these rules:

- explicit city targeting is preserved as one target;
- explicit region targeting is preserved as one target;
- country-only United States targeting expands into the 50 states plus District of Columbia;
- other country-only targeting falls back to one country-level target rather than fabricating subdivisions.

For example, a 10,000-lead United States Dentist campaign produces:

```text
7 deterministic queries × 51 geographic targets = 357 SearchTask rows
```

The requested lead count remains the campaign objective. SearchTask count represents the search space, not the requested result count.

### Provider identifier

M3 stores:

```text
provider = google-places
```

This is only a planning identifier used to partition and deduplicate search space. Milestone 3 does **not** call Google Places, add a Google SDK, require a provider credential, paginate provider responses, or persist discovered businesses.

The real `BusinessDiscoveryProvider` abstraction and provider-specific network behavior belong to Milestone 4.

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

`apps/worker` is a separate process with its own PostgreSQL/pg-boss lifecycle. It registers consumers for `system-test` and `campaign-plan`.

Both processors run through the tracked-job execution wrapper. Each attempt records `RUNNING` and increments `attempts`; success records `COMPLETED`; failure records `FAILED` with `failureReason` and rethrows so pg-boss owns retry/backoff and eventual dead-letter behavior.

Unlike M2's no-op planning handoff, the M3 production `campaign-plan` processor now loads the persisted campaign and creates/reuses its `SearchPlan` and missing `SearchTask` rows. It still performs no external discovery.

Stopping or restarting the API/producer does not erase queued jobs. A separately started worker can consume a persisted `campaign-plan` job and create search space after the producer has stopped.

## Environment variables

```text
DATABASE_URL
APP_URL
API_URL
NEXT_PUBLIC_API_URL
NODE_ENV
OPENAI_API_KEY
```

`OPENAI_API_KEY` remains optional and unused in Milestone 3.

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
- SearchPlan/SearchTask persistence includes the resumable task defaults and counters;
- a 10,000-lead United States Dentist campaign generates many smaller persisted search tasks;
- planner replay inserts no duplicate tasks and preserves a completed task's status/counters;
- workspace/campaign identifier mismatch is rejected inside planning;
- cancelled campaigns create no search space;
- a queued job survives producer shutdown and is completed by a separately started worker;
- a real `campaign-plan` job survives producer shutdown and an independent worker creates persisted SearchPlan/SearchTask rows;
- duplicate scheduling with the same workspace-scoped idempotency key produces one persisted job;
- failed queue attempts are retried and attempt counts are persisted;
- terminal failures remain visible with their failure reason after retries are exhausted.

Pure unit tests cover the exact Dentist expansion set, unknown-niche fallback, explicit geography preservation, the 51-target U.S. subdivision catalog, and identifier-only campaign-plan payload shape.

## Milestone boundary

Milestone 3 ends with durable, deterministic, resumable search-space planning. `SearchPlan` and `SearchTask` describe **what should be searched**; they do not perform the search.

Milestone 4 owns real business discovery: a `BusinessDiscoveryProvider` abstraction, provider-specific API/network calls, pagination, candidate normalization and persistence, result counters, and the `campaign-discovery` execution path. Enrichment, website crawling, AI research, outreach generation, SSE progress streaming, and higher-level autonomous orchestration remain later milestones.
