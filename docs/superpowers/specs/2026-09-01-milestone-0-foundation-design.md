# Milestone 0 — Project Foundation Design

## Scope

Bootstrap the empty `ai-lead-intelligence-crm` repository into a production-oriented TypeScript monorepo. This milestone includes only foundation concerns: web, API, worker, PostgreSQL/Prisma, validated configuration, authentication, workspaces, multi-tenancy, and verification. It intentionally excludes queues, campaigns, discovery, enrichment, AI orchestration, crawling, and later product logic.

## Architecture

Use a pnpm workspace with Turborepo-style task orchestration and these boundaries:

- `apps/web`: Next.js App Router UI, Tailwind CSS, TanStack Query, auth/workspace flows.
- `apps/api`: NestJS HTTP API. Trusted backend boundary for authentication, workspace authorization, and database access.
- `apps/worker`: independent Node.js process with its own bootstrap and health lifecycle; no Milestone 1 queue implementation yet.
- `packages/database`: Prisma schema/client and seed/bootstrap helpers.
- `packages/config`: Zod-based environment validation shared by server processes.
- `packages/schemas`: transport/domain validation schemas shared across applications.
- `packages/shared`: framework-independent shared types/utilities.
- `packages/queue`: reserved package boundary only; no queue implementation until Milestone 1.

## Authentication

Use backend-owned email/password authentication for Milestone 0 to keep the foundation self-contained and provider-replaceable. Passwords are hashed with Argon2. Successful login/registration creates a random opaque session token; only a SHA-256 hash is stored in PostgreSQL. The raw token is returned once and used as a Bearer token by the web client. Sessions have an expiry timestamp and can be revoked.

Authentication is intentionally isolated behind an `AuthService` so a managed identity provider can replace it later without changing workspace/domain code.

## Workspace model and multi-tenancy

Core entities are `User`, `Workspace`, and `WorkspaceMember`, plus an auth-only `Session` table required to implement secure login. A user may belong to multiple workspaces, but every authenticated application operation selects one workspace explicitly. Workspace-scoped repository/service methods require `workspaceId` and authorize membership before access.

The dashboard endpoint is workspace-scoped and will reject a workspace ID for which the current user has no membership. This establishes the tenancy pattern that future entities must follow.

## User flows

1. Registration: create user, create initial workspace, add the user as OWNER, create session.
2. Login: verify credentials, create session, return memberships.
3. Workspace creation: authenticated user creates a workspace and becomes OWNER.
4. Workspace entry: the web app stores the selected workspace ID in browser state and requests `/workspaces/:workspaceId/dashboard`.
5. Dashboard: render authenticated user/workspace context only after backend membership authorization.

## Configuration

Environment variables are parsed at process startup with Zod. Required server variables are `DATABASE_URL`, `APP_URL`, `API_URL`, and `NODE_ENV`. `OPENAI_API_KEY` is accepted as optional and unused in this milestone. Invalid configuration fails fast with a readable error.

## Worker

`apps/worker` is an independently runnable Node.js service. For Milestone 0 it validates configuration, opens a database connection, reports readiness, handles SIGINT/SIGTERM, and disconnects cleanly. Durable jobs are deliberately deferred to Milestone 1.

## Testing

- Unit tests for config validation and auth/session helpers.
- API integration tests for registration/login, workspace creation, and cross-workspace authorization.
- Database-backed tests where PostgreSQL is available.
- Web component/flow tests for auth and workspace selection where practical.
- Root scripts for `test`, `typecheck`, `lint`, and `build`.

## Security decisions

- Password hashes only; never plaintext passwords.
- Opaque session tokens are hashed before persistence.
- Workspace authorization occurs in trusted API code, not the frontend.
- No database credential or OpenAI key is exposed through `NEXT_PUBLIC_*` variables.
- Validation occurs at HTTP and environment boundaries.

## Acceptance criteria mapping

- Register/login: auth endpoints and web auth UI.
- Create/enter workspace: workspace endpoints and selector UI.
- Access dashboard: membership-authorized dashboard endpoint/UI.
- API works: NestJS health endpoint plus integration tests.
- Database/migrations work: Prisma schema and initial migration.
- Worker starts independently: separate worker package/process.
- Build quality: root lint, typecheck, tests, and build scripts.

## Explicit non-goals

No pg-boss, Redis, BullMQ, RabbitMQ, Kafka, Temporal, campaign model, discovery provider, LangGraph graph, OpenAI call, SSE progress, crawler, CRM, or outreach behavior is implemented in Milestone 0.
