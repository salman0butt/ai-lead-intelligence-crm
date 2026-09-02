# AI Lead Intelligence CRM

Autonomous AI Lead Intelligence & Sales CRM built as milestone-based production vertical slices.

The current verified candidate is **Milestone 5 — Deduplication Engine**. Milestones 0–4 provide authentication/tenancy, a durable PostgreSQL job system, campaign lifecycle management, deterministic search planning, and browser-based business discovery. Milestone 5 adds workspace-scoped canonical businesses, deterministic layered deduplication, candidate match audit metadata, concurrency-safe canonical creation, atomic discovery canonicalization, and an idempotent backfill for candidates created before M5.

## Architecture

```text
apps/
  web/       Next.js + React + TypeScript + Tailwind + TanStack Query
  api/       NestJS API, authentication, workspaces, campaigns, job scheduling/status
  worker/    Independent pg-boss worker, planner, discovery + canonicalization orchestration

packages/
  config/    Zod environment validation
  database/  Prisma + PostgreSQL models and migrations
  discovery/ Provider-neutral discovery + deterministic deduplication primitives
  queue/     QueueService contract + pg-boss adapter
  schemas/   Shared request schemas
  shared/    Shared application types
```

PostgreSQL remains the durable store for application state, discovery state, canonical businesses, and pg-boss jobs. The initial architecture intentionally does **not** use Redis, BullMQ, RabbitMQ, Kafka, or Temporal.

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
- Canonical `Business` records and all M5 matching decisions are workspace-scoped; candidates from different workspaces are never linked to the same canonical row.

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

Rendered listing cards are normalized into `BusinessCandidate` records with the M4 discovery identity/provenance fields:

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

M5 additionally provides nullable identity input slots for:

```text
city
postalCode
phone
canonicalDomain
```

Current M4 browser candidates may leave those values null. M5 consumes them when present but does not discover or verify them.

`BusinessSource` preserves provenance back to the `SearchTask` and raw provider result. A campaign-level uniqueness key on `(campaignId, provider, providerExternalId)` prevents the same provider business from creating duplicate candidates when multiple search tasks encounter it.

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

## Deduplication engine

Milestone 5 turns raw campaign-scoped `BusinessCandidate` records into workspace-scoped canonical `Business` records. It is deterministic: there are no AI calls, embeddings, network requests, or new queues in the matching path.

### Canonical business and candidate audit fields

`Business` stores the canonical display identity plus normalized lookup fields:

```text
workspaceId
name / normalizedName
formattedAddress / normalizedAddress
city / normalizedCity
postalCode / normalizedPostalCode
phone / normalizedPhone
canonicalDomain
```

Every newly persisted M5 discovery candidate leaves its page transaction with:

```text
matchedBusinessId
duplicateConfidence
duplicateReason
```

`duplicateReason` is machine-readable and records one of:

```text
PROVIDER_EXTERNAL_ID
CANONICAL_DOMAIN
PHONE
NAME_ADDRESS_EXACT
NAME_CITY_POSTAL_EXACT
FUZZY_HIGH_CONFIDENCE
FUZZY_LOW_CONFIDENCE_NOT_MERGED
NEW_CANONICAL
```

For a new canonical business, confidence is `0`. Exact duplicate rules use fixed confidence values, while fuzzy decisions persist the deterministic calculated score.

### Matching order

Canonicalization always stays inside one workspace and evaluates rules in this order:

```text
existing candidate association
provider + providerExternalId
canonical domain
normalized phone
normalized name + normalized address
normalized name + normalized city + normalized postal code
cautious fuzzy fallback
new canonical Business
```

Exact matching never chooses an arbitrary row when multiple eligible canonical businesses satisfy a rule. Ambiguous exact results continue to later rules and create a new canonical business if no later rule resolves the candidate uniquely.

For secondary exact and fuzzy rules, conflicting non-null strong identifiers such as different normalized phones or domains veto the weaker merge.

### Conservative fuzzy fallback

Fuzzy matching only runs with geographic support: matching postal code first, otherwise matching city. It uses deterministic normalized edit similarity and token Jaccard scoring.

An automatic fuzzy merge requires all of:

```text
overall score >= 0.93
name similarity >= 0.90
address similarity >= 0.88
matching city or postal support
best eligible score leads the second-best by >= 0.03
```

A rejected possible duplicate with score at least `0.80` receives its own canonical business and the reason `FUZZY_LOW_CONFIDENCE_NOT_MERGED`. This deliberately favors false negatives over false-positive merges.

### Transaction and concurrency safety

M5 extends the existing M4 page-persistence transaction. The order is:

```text
acquire workspace transaction-scoped advisory lock
for each normalized provider result:
  upsert BusinessCandidate
  canonicalize candidate
  persist BusinessSource provenance
update SearchTask cursor/counters/state
update ProviderUsage result count
commit
```

Canonicalization failure rolls back candidate/source/task/result persistence for that page. It is not misclassified as a provider failure. PostgreSQL transaction-scoped advisory locking serializes canonical match/create decisions inside one workspace while leaving different workspaces independent.

### Pre-M5 candidate backfill

Candidates that existed before the M5 migration can be canonicalized with the local worker command after the worker has been built:

```bash
pnpm --filter @ai-crm/worker backfill:business-candidates
```

The backfill is restart-safe and idempotent. It processes unmatched candidates in stable workspace and candidate order, uses bounded workspace transactions (default batch size `100`), acquires the same workspace advisory lock, and calls the same canonicalizer used by live discovery. A second successful run has no remaining unmatched candidates to process.

The command prints aggregate processed/matched counts only. It does not enqueue pg-boss work or make provider/network requests.

### M6 domain boundary

M5 may compare `canonicalDomain` when another trusted part of the system has supplied that value. It **does not** discover, visit, resolve, or verify an official website. **Milestone 6 — Domain Resolution & Website Verification** owns that behavior.

## Optional AI page interpretation

Rendered deterministic extraction is always the primary path. AI is optional and is only composed when both variables are present:

```text
OPENAI_API_KEY
DISCOVERY_AI_MODEL
```

The interpreter receives a small sanitized snapshot containing only bounded page URL/title/visible text/semantic accessibility summary. It uses the OpenAI Responses API with structured output and `store: false` to classify states such as no-results, blocked/CAPTCHA, consent, or unknown layout.

AI is **not** allowed to click, invent selectors, control the browser, solve challenges, or bypass source restrictions. Unknown/ambiguous layouts fail closed.

No AI key or model is required for normal browser discovery or M5 deduplication.

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

`campaign-plan` persists/replays search space and schedules unfinished discovery tasks. `campaign-discovery` validates the current campaign generation, claims one task/page, invokes the configured discovery provider, and persists candidate canonicalization, provenance, counters, cursor, and provider usage transactionally before scheduling continuation when required.

M5 does not introduce another queue.

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

There is no `GOOGLE_PLACES_API_KEY` requirement and M5 adds no external-service credential.

## Verification

Standard repository verification:

```bash
pnpm verify
```

CI additionally installs Playwright Chromium explicitly. The complete gate covers:

- frozen pnpm install;
- Playwright Chromium installation;
- Prisma schema validation and all migrations;
- deterministic deduplication unit tests;
- PostgreSQL-backed canonicalization, backfill, worker, and API integration tests;
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

Milestone 5 ends at deterministic workspace-scoped canonical business creation/reuse, candidate match audit fields, cautious fuzzy fallback, concurrency-safe atomic discovery canonicalization, and idempotent pre-M5 backfill.

The next milestone is **Milestone 6 — Domain Resolution & Website Verification**. Website crawling, contact enrichment, website auditing, AI research, opportunity detection, lead scoring, CRM workflows, outreach, autonomous campaign policies, and AI Copilot behavior remain later milestones and are intentionally not implemented in M5.

See `docs/milestones/STATUS.md` for the roadmap ledger.
