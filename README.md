# AI Lead Intelligence CRM

Autonomous AI Lead Intelligence & Sales CRM built as milestone-based production vertical slices.

The current candidate is **Milestone 4 — Browser Business Discovery**. Milestones 0–3 provide authentication/tenancy, a durable PostgreSQL job system, campaign lifecycle management, and deterministic search planning. Milestone 4 adds real public-page business discovery through an isolated browser provider, durable cursor continuation, normalized candidate/provenance storage, provider usage accounting, bounded browser concurrency, pause/resume generation safety, and optional AI page classification.

## Architecture

```text
apps/
  web/       Next.js + React + TypeScript + Tailwind + TanStack Query
  api/       NestJS API, authentication, workspaces, campaigns, job scheduling/status
  worker/    Independent pg-boss worker, planner, discovery orchestration

packages/
  config/    Zod environment validation
  database/  Prisma + PostgreSQL models and migrations
  discovery/ Provider-neutral discovery contract + browser implementation
  queue/     QueueService contract + pg-boss adapter
  schemas/   Shared request schemas
  shared/    Shared application types
```

PostgreSQL remains the durable store for application state, discovery state, and pg-boss jobs. The initial architecture intentionally does **not** use Redis, BullMQ, RabbitMQ, Kafka, or Temporal.

## Prerequisites

- Node.js 24+
- pnpm 11.24+
- Docker with Docker Compose
- Chromium installed for Playwright browser discovery

Install dependencies and Chromium:

```bash
pnpm install
pnpm --filter @ai-crm/discovery exec playwright install --with-deps chromium
```

## Local setup

```bash
cp .env.example .env
pnpm db:up
pnpm db:deploy
pnpm build
```

Start each process independently:

```bash
pnpm start:api
pnpm start:worker
pnpm start:web
```

The web application is available at `http://localhost:3000` and the API at `http://localhost:4000`.

## Authentication and tenancy

- Passwords are hashed with Argon2.
- Login sessions use opaque random bearer tokens; only token hashes are persisted.
- Every registered user starts with a workspace and `OWNER` membership.
- Workspace-scoped API operations authorize through `WorkspaceMember`.
- Campaign planning and discovery validate both workspace and campaign/task relationships before executing work.

## Campaign lifecycle

Campaign status is:

```text
DRAFT
PLANNING
DISCOVERING
PAUSED
CANCELLED
```

The main flow is:

```text
DRAFT
  ↓ start
PLANNING
  ↓ campaign-plan worker
DISCOVERING
  ↓ pause
PAUSED
  ↓ resume
PLANNING
```

Cancel is allowed from the active pre-terminal states. Lifecycle transitions use conditional database updates so stale concurrent transitions fail instead of silently winning.

Every successful lifecycle transition changes `Campaign.updatedAt`. Discovery jobs carry that timestamp as their `campaignVersion`. Before any provider/browser/AI work, the worker compares the queued generation with the current campaign. Paused, cancelled, or old-generation jobs exit without launching provider I/O. Resume publishes a fresh versioned `campaign-plan` job and the planner hands off fresh discovery jobs.

## Search planning

Milestone 3 creates one durable `SearchPlan` per campaign and deterministic `SearchTask` rows. Planning is replay-safe through database uniqueness and `createMany(..., skipDuplicates: true)`.

The current Dentist expansion is deterministic:

```text
Dentist
Dental Clinic
Family Dentist
Cosmetic Dentist
Orthodontist
Pediatric Dentist
Emergency Dentist
```

Country-only United States targeting expands to the 50 states plus District of Columbia; explicit region/city targeting is preserved; other country-only targeting remains country-level.

Search tasks use:

```text
provider = google-maps-browser
```

This is a provider identifier behind the discovery abstraction, not a Google Places API integration.

## Browser business discovery

Milestone 4 introduces `packages/discovery` and the provider-neutral contract used by the worker:

```text
searchBusinesses(input)
continueSearch(input, cursor)
normalizeResult(raw)
```

The first implementation is `GoogleMapsBrowserProvider` using Playwright/Chromium against rendered public Google Maps pages.

### Source boundary

The provider reads rendered page content and public listing links. It does **not** use:

- Google Places API or a Google Places API key;
- a Google Maps SDK;
- hidden/internal Maps data or network endpoints;
- response interception to extract private application payloads;
- CAPTCHA solving or access-control bypass;
- stealth plugins, fingerprint spoofing, proxy rotation, or evasion logic.

If the public source presents a CAPTCHA, consent wall, or access block, discovery stops and records the provider failure. The system never automates a bypass.

### Extraction and normalization

Rendered listing cards are normalized into `BusinessCandidate` records with:

```text
workspaceId
campaignId
provider
providerExternalId
name
formattedAddress
category
latitude
longitude
rawReference
```

`BusinessSource` preserves provenance back to the `SearchTask` and raw provider result. A campaign-level uniqueness key on `(campaignId, provider, providerExternalId)` prevents the same provider business from creating duplicate candidates when multiple search tasks encounter it.

Milestone 5 owns broader canonical cross-source deduplication; M4 intentionally does not implement it.

### Durable continuation

Browser continuation is not held in process memory. `SearchTask` persists:

```text
continuationCursor
pageNumber
status
attemptCount
resultCount
uniqueBusinessCount
```

The Google Maps browser cursor is bounded and versioned. It records stable seen listing IDs and scroll progress so a new browser session can resume without relying on process-local state.

Each continuation job has deterministic idempotency based on task, campaign generation, and page number. If a page commits to PostgreSQL but publication of the next-page job fails, replay of the old job detects the already-advanced persisted task and repairs the missing enqueue without repeating provider I/O.

### Failure isolation and usage accounting

Each `SearchTask` executes independently. A provider failure marks only that task failed and rethrows so pg-boss owns retry/backoff/dead-letter behavior; it does not fail the entire campaign.

`ProviderUsage` aggregates per campaign/provider:

```text
requestCount
resultCount
errorCount
rateLimitCount
costAmount (nullable)
costCurrency (nullable)
```

Access-block/rate-limit classifications can increment `rateLimitCount` when applicable.

### Browser concurrency and runtime configuration

Production composition wraps the browser provider in a provider-neutral concurrency limiter. Default concurrency is deliberately conservative at one active discovery call per worker process.

```text
DISCOVERY_BROWSER_HEADLESS=true
DISCOVERY_BROWSER_CONCURRENCY=1
DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS=30000
DISCOVERY_BROWSER_ACTION_TIMEOUT_MS=10000
```

Validation bounds are:

```text
concurrency: 1..8
navigation timeout: 1..120000 ms
action timeout: 1..60000 ms
```

Creating the worker/provider registry does not launch Chromium. A browser session is opened only when an eligible current-generation discovery job actually executes.

## Optional AI page interpretation

Rendered deterministic extraction is always the primary path. AI is optional and is only composed when both variables are present:

```text
OPENAI_API_KEY
DISCOVERY_AI_MODEL
```

The interpreter receives a small sanitized snapshot containing only bounded page URL/title/visible text/semantic accessibility summary. It uses the OpenAI Responses API with structured output and `store: false` to classify states such as no-results, blocked/CAPTCHA, consent, or unknown layout.

AI is **not** allowed to click, invent selectors, control the browser, solve challenges, or bypass source restrictions. Unknown/ambiguous layouts fail closed.

No AI key or model is required for normal browser discovery.

## Queue system

Application code depends on `QueueService`; pg-boss remains the PostgreSQL-backed implementation. The durable application queues are:

```text
system-test
campaign-plan
campaign-discovery
business-enrichment
website-crawl
business-research
outreach-generation
```

Each has a dead-letter queue and centralized retry/backoff/concurrency/retention settings. Queue payloads contain identifiers and small control fields only; scraped content belongs in durable storage.

`campaign-plan` persists/replays search space and schedules unfinished discovery tasks. `campaign-discovery` validates the current campaign generation, claims one task/page, invokes the configured discovery provider, persists candidates/provenance/counters/cursor transactionally, and schedules continuation when required.

## Environment variables

Required server variables:

```text
DATABASE_URL
APP_URL
API_URL
NODE_ENV
```

Frontend:

```text
NEXT_PUBLIC_API_URL
```

Browser discovery:

```text
DISCOVERY_BROWSER_HEADLESS
DISCOVERY_BROWSER_CONCURRENCY
DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS
DISCOVERY_BROWSER_ACTION_TIMEOUT_MS
```

Optional AI fallback:

```text
OPENAI_API_KEY
DISCOVERY_AI_MODEL
```

There is no `GOOGLE_PLACES_API_KEY` requirement.

## Verification

Standard repository verification:

```bash
pnpm verify
```

CI additionally installs Playwright Chromium explicitly. The full M4 gate covers:

- frozen pnpm install;
- Playwright Chromium installation;
- Prisma schema validation and all migrations;
- unit tests;
- PostgreSQL-backed worker/API integration tests;
- real Chromium local-fixture discovery tests;
- pg-boss durability/retry integration tests;
- typecheck;
- lint;
- build;
- compiled API/worker/web smoke start.

Standard CI never requires Google credentials and never spends Google or OpenAI quota.

### Opt-in live public-page smoke

A narrow live browser smoke exists but is intentionally excluded from normal CI:

```bash
RUN_LIVE_BROWSER_DISCOVERY_TESTS=1 \
  pnpm --filter @ai-crm/discovery test -- google-maps-browser.live.test.ts
```

It may discover rendered public businesses, or explicitly report that the source presented a CAPTCHA/access block and stop. It never bypasses that condition. Because public-page layout/access policy can change independently of this repository, use the live smoke as a diagnostic rather than a deterministic CI gate.

## Current milestone boundary

Milestone 4 ends at real business discovery, normalization/provenance, provider usage, durable browser continuation, generation safety, and browser runtime composition.

The next milestone is **Milestone 5 — Deduplication Engine**. Domain resolution, crawling, contact enrichment, website auditing, AI research, opportunity detection, lead scoring, CRM workflows, outreach, autonomous campaign policies, and AI Copilot behavior remain later milestones and are intentionally not implemented here.

See `docs/milestones/STATUS.md` for the roadmap ledger.
