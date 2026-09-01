# AI Lead Intelligence CRM

Autonomous AI Lead Intelligence & Sales CRM.

This repository is currently scoped to **Milestone 0 — Project Foundation**. Lead discovery, pg-boss queues, campaign orchestration, crawling, enrichment, and AI research belong to later milestones and are intentionally not implemented here yet.

## Milestone 0 architecture

```text
apps/
  web/       Next.js + React + TypeScript + Tailwind + TanStack Query
  api/       NestJS + TypeScript
  worker/    Independent background worker process

packages/
  database/  Prisma + PostgreSQL client and migrations
  queue/     Package boundary only; pg-boss starts in Milestone 1
  shared/    Shared application types
  config/    Zod environment validation
  schemas/   Shared request schemas
```

## Prerequisites

- Node.js 24+
- pnpm 11.24+
- Docker with Docker Compose

## Local setup

1. Create the local environment file.

```bash
cp .env.example .env
```

2. Install dependencies.

```bash
pnpm install
```

3. Start PostgreSQL.

```bash
pnpm db:up
```

4. Apply the committed Prisma migration.

```bash
pnpm db:deploy
```

5. Build all packages and applications.

```bash
pnpm build
```

6. Start each process independently in separate terminals.

```bash
pnpm start:api
```

```bash
pnpm start:worker
```

```bash
pnpm start:web
```

The web application is available at `http://localhost:3000` and the API at `http://localhost:4000`.

For frontend-only development after the shared packages are built, use:

```bash
pnpm dev:web
```

## Milestone 0 user flow

1. Open `http://localhost:3000/register`.
2. Register with a name, email, password, and workspace name.
3. Registration creates the user and their first workspace membership atomically.
4. The user is taken to `/dashboard`.
5. The dashboard can create additional workspaces and switch between memberships.
6. Signing out removes the browser session token and returns to login.

Backend authorization verifies workspace membership before returning workspace-scoped data. Supplying another workspace ID without membership is rejected by the API.

## Environment variables

```text
DATABASE_URL
APP_URL
API_URL
NEXT_PUBLIC_API_URL
NODE_ENV
OPENAI_API_KEY
```

`OPENAI_API_KEY` is optional in Milestone 0 and is not used yet.

## Database

Validate the Prisma schema:

```bash
pnpm db:validate
```

Create a development migration after an intentional schema change:

```bash
pnpm db:migrate
```

Apply committed migrations without creating new ones:

```bash
pnpm db:deploy
```

Stop local PostgreSQL:

```bash
pnpm db:down
```

## Verification

Run the application checks:

```bash
pnpm verify
```

CI additionally starts PostgreSQL, validates and applies migrations, executes the database-backed authentication/workspace integration test, and smoke-starts the compiled API, worker, and web application as independent processes.

## Authentication and tenancy

- Passwords are hashed with Argon2.
- Login sessions use opaque random bearer tokens.
- Only a SHA-256 hash of each session token is stored in PostgreSQL.
- Every registered user starts with a workspace and an `OWNER` membership.
- Workspace-scoped API access is checked against `WorkspaceMember` on the backend.
- Client-provided workspace IDs are never treated as authorization by themselves.

## Milestone boundary

Milestone 0 ends with a working authenticated, multi-tenant application foundation and an independently runnable worker.

Milestone 1 will introduce the PostgreSQL-backed job system with pg-boss behind the `QueueService` abstraction. Do not add Redis, BullMQ, RabbitMQ, Kafka, or Temporal to the initial architecture.
