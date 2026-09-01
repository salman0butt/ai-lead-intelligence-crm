# Milestone 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the empty repository into a working, tested, multi-tenant TypeScript monorepo with Next.js, NestJS, Prisma/PostgreSQL, authentication, workspaces, and an independently runnable worker.

**Architecture:** A pnpm workspace separates deployable apps from shared packages. The NestJS API owns authentication and workspace authorization; Prisma is the persistence boundary; the Next.js client consumes typed HTTP contracts; the worker is a separate process that shares config/database packages but contains no queue implementation yet.

**Tech Stack:** pnpm, Turborepo, Next.js, React, TypeScript, Tailwind CSS, TanStack Query, NestJS, Prisma, PostgreSQL, Zod, Argon2, Vitest/Jest, Playwright-ready web setup.

**Spec:** `docs/superpowers/specs/2026-09-01-milestone-0-foundation-design.md`

## Global Constraints

- Do not implement Milestone 1 queue behavior.
- Do not add Redis, BullMQ, RabbitMQ, Kafka, or Temporal.
- Every future domain entity must be workspace-scoped; Milestone 0 establishes authorization through workspace membership.
- `OPENAI_API_KEY` is optional and unused.
- Root commands must expose tests, typecheck, lint, and build.

---

### Task 1: Monorepo scaffold and shared validation

**Files:** root workspace/config files; `packages/config`; `packages/schemas`; `packages/shared`; reserved `packages/queue`.

**Interfaces:**
- Produces `loadServerEnv(input)` returning validated environment config.
- Produces Zod schemas for registration, login, and workspace creation.

- [ ] Write config validation tests that fail before implementation.
- [ ] Implement Zod environment parsing and shared schemas.
- [ ] Add workspace tooling, TypeScript base config, lint config, formatting/editor defaults, `.env.example`, and README commands.
- [ ] Run package tests/typecheck.

### Task 2: Prisma database foundation

**Files:** `packages/database/package.json`, `src/client.ts`, `prisma/schema.prisma`, initial migration SQL.

**Interfaces:**
- Produces singleton `prisma` / `createPrismaClient()`.
- Models `User`, `Workspace`, `WorkspaceMember`, and auth-only `Session`.

- [ ] Add schema-level tests/validation where practical before client implementation.
- [ ] Implement Prisma schema with membership uniqueness, roles, session expiry/revocation, and indexes.
- [ ] Generate initial migration SQL.
- [ ] Run Prisma validation/generation.

### Task 3: NestJS API authentication and workspace tenancy

**Files:** `apps/api/src/**` plus API tests.

**Interfaces:**
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /workspaces`
- `GET /workspaces`
- `GET /workspaces/:workspaceId/dashboard`
- `GET /health`

- [ ] Write failing tests for password/session helpers and workspace authorization behavior.
- [ ] Implement Argon2 password hashing and opaque SHA-256-hashed bearer sessions.
- [ ] Implement auth guard/current-user context.
- [ ] Implement workspace service/controller with membership checks on scoped access.
- [ ] Add integration tests using injectable repositories/Prisma boundary where DB-independent tests are possible.
- [ ] Run API tests/typecheck/lint.

### Task 4: Independent worker process

**Files:** `apps/worker/src/**` and worker tests.

**Interfaces:**
- Worker bootstrap validates env, connects Prisma, exposes lifecycle functions, handles SIGINT/SIGTERM, and disconnects cleanly.

- [ ] Write failing lifecycle test.
- [ ] Implement bootstrap/readiness/shutdown without queue logic.
- [ ] Run worker tests/typecheck/lint.

### Task 5: Next.js authentication/workspace vertical slice

**Files:** `apps/web/app/**`, `apps/web/components/**`, `apps/web/lib/**`, web tests.

**Interfaces:**
- Auth pages call API register/login.
- Dashboard fetches memberships and workspace-scoped dashboard data.
- TanStack Query provider owns server-state fetching.

- [ ] Write failing tests for API client auth header/workspace behavior and key UI states.
- [ ] Implement Tailwind/App Router shell, QueryClient provider, API client, register/login forms, workspace selector/creation, dashboard.
- [ ] Run web tests/typecheck/lint/build.

### Task 6: End-to-end verification and CI

**Files:** root scripts, `.github/workflows/ci.yml`, optional compose file for PostgreSQL, documentation.

- [ ] Add CI that installs with frozen lockfile then runs Prisma generation, lint, typecheck, tests, and build.
- [ ] Add local PostgreSQL compose service and documented setup/migration commands.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` locally.
- [ ] Verify Prisma schema and migration against PostgreSQL when local Docker is available.
- [ ] Record any environment-limited verification explicitly rather than claiming success.
