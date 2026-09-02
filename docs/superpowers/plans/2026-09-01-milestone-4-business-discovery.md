# Milestone 4 Business Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute durable provider-isolated business discovery from M3 SearchTasks using AI-guided Playwright browser access rather than Google Places API, normalize/store candidates with provenance and source usage, and make browser continuation/pause/resume crash-safe.

**Architecture:** Keep the existing M4 PostgreSQL/pg-boss orchestration and provider registry, replace the Google Places API adapter with a `google-maps-browser` Playwright provider, and replace API page-token state with a provider-neutral PostgreSQL continuation cursor. Deterministic DOM/accessibility extraction is primary; an optional AI page interpreter is a bounded recovery layer for ambiguous layouts and blocked/consent classification, never a CAPTCHA/access-control bypass.

**Tech Stack:** TypeScript 6, PostgreSQL 17, Prisma, pg-boss 12.28.0, Playwright 1.62.1 with Chromium, optional OpenAI Responses API through native `fetch`, Zod config, Vitest, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-01-milestone-4-business-discovery-design.md`

## Global Constraints

- Keep PostgreSQL/pg-boss; do not add Redis, BullMQ, RabbitMQ, Kafka, or Temporal.
- Do not use Google Places API, Google SDK, `GOOGLE_PLACES_API_KEY`, hidden Maps data endpoints, or undocumented internal APIs.
- Provider/browser code stays isolated in `packages/discovery`; campaign/domain code remains source-neutral.
- First production source is `google-maps-browser` using rendered public browser content.
- Do not bypass CAPTCHA, login walls, paywalls, anti-bot controls, or other access restrictions.
- Do not add stealth plugins, fingerprint spoofing, proxy rotation, identity rotation, or CAPTCHA solving.
- Standard CI uses local rendered fixtures and needs no Google or AI credential.
- Playwright version is pinned at `1.62.1`; CI explicitly installs Chromium/browser dependencies.
- Browser continuation state lives in PostgreSQL, never only in queue payload or process memory.
- `campaign-discovery` remains the queue name.
- M4 does not implement M5 canonical/fuzzy deduplication, M6 domain verification, M7 crawling, M8 contact enrichment, M9 audit, M10 lead research, M16 results UI, or outreach.
- Every behavior change follows RED -> minimal implementation -> exact-head GREEN CI.

## Current checkpoint

Already implemented and retained from the pre-pivot M4 branch:

- `BusinessCandidate`, `BusinessSource`, `ProviderUsage` persistence.
- `CampaignStatus.DISCOVERING` and pause/resume/cancel generation behavior.
- planning-to-discovery pg-boss scheduling.
- `campaign-discovery` identifier/version/page payload and deterministic idempotency.
- initial worker-side discovery persistence processor.
- provider-neutral registry/types foundation.

Pre-pivot Google Places API files/config/tests are temporary branch code and must be removed/replaced before M4 review.

---

### Task 1: Remove Google API assumptions and make provider/cursor state browser-neutral

**Files:**
- Modify: `packages/discovery/src/types.ts`
- Modify: `packages/discovery/src/index.ts`
- Delete: `packages/discovery/src/google-places.provider.ts`
- Delete: `packages/discovery/test/google-places.provider.test.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/test/env.test.ts`
- Modify: `.env.example`
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `packages/database/prisma/migrations/20260901120000_business_discovery/migration.sql`
- Modify: `apps/worker/src/search-planner/search-planner.ts`
- Modify: `apps/worker/test/search-planner.integration.test.ts`
- Modify: `apps/worker/test/business-discovery-persistence.integration.test.ts`

**Produces:**

```ts
export interface BusinessDiscoveryPage<TRaw> {
  results: readonly TRaw[];
  nextCursor: string | null;
}

export interface BusinessDiscoveryProvider<TRaw = unknown> {
  readonly name: string;
  searchBusinesses(input: BusinessSearchInput): Promise<BusinessDiscoveryPage<TRaw>>;
  continueSearch(input: BusinessSearchInput, cursor: string): Promise<BusinessDiscoveryPage<TRaw>>;
  normalizeResult(raw: TRaw): NormalizedBusiness;
  close?(): Promise<void>;
}
```

SearchTask field:

```prisma
continuationCursor String? @db.Text
pageNumber         Int     @default(1)
```

- [ ] **Step 1: write failing tests for the new contract**

Update persistence test:

```ts
expect(task.continuationCursor).toBeNull();
expect(task.pageNumber).toBe(1);
```

Update planner integration:

```ts
expect(new Set(tasks.map((task) => task.provider))).toEqual(new Set(['google-maps-browser']));
```

Update config tests:

```ts
expect(env).not.toHaveProperty('GOOGLE_PLACES_API_KEY');
```

Update provider contract test fixture so provider implementations expose `continueSearch()` and pages expose `nextCursor`.

- [ ] **Step 2: run CI and verify RED**

Expected failures: old `nextPageToken`, `getNextPage`, `google-places`, and Google API config remain.

- [ ] **Step 3: implement browser-neutral contract minimally**

Rename `nextPageToken -> continuationCursor` in Prisma and worker-facing code. Rename `getNextPage -> continueSearch`, `nextPageToken -> nextCursor` in discovery package types.

Change planner default constant to:

```ts
export const DEFAULT_DISCOVERY_PROVIDER = 'google-maps-browser';
```

Add to the still-unmerged M4 migration after SearchTask column creation:

```sql
UPDATE "SearchTask"
SET "provider" = 'google-maps-browser'
WHERE "provider" = 'google-places';
```

Remove `GOOGLE_PLACES_API_KEY` from config/env example/tests and delete the API adapter/tests/exports.

- [ ] **Step 4: run full CI and verify GREEN**

- [ ] **Step 5: commit**

Commit: `refactor: make discovery browser-native`.

---

### Task 2: Add Playwright browser runtime and deterministic Maps listing identity

**Files:**
- Modify: `packages/discovery/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/discovery/src/browser/browser-session.ts`
- Create: `packages/discovery/src/browser/maps-url.ts`
- Create: `packages/discovery/src/browser/browser-errors.ts`
- Create: `packages/discovery/test/maps-url.test.ts`
- Create: `packages/discovery/test/browser-session.test.ts`
- Modify: `.github/workflows/ci.yml`

**Produces:**

```ts
export interface BrowserRuntimeOptions {
  headless: boolean;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
}

export class BrowserSessionFactory {
  constructor(options: BrowserRuntimeOptions);
  open(): Promise<{ browser: Browser; context: BrowserContext; page: Page }>;
}

export class DiscoveryAccessBlockedError extends DiscoveryProviderError {
  readonly blocked = true;
}
```

Identity helpers:

```ts
export function buildGoogleMapsSearchUrl(searchText: string): string;
export function normalizeMapsListingUrl(url: string): string;
export function mapsListingExternalId(url: string): string;
```

- [ ] **Step 1: write failing URL/identity tests**

```ts
expect(buildGoogleMapsSearchUrl('Dentist in Austin, Texas, United States'))
  .toBe('https://www.google.com/maps/search/?api=1&query=Dentist%20in%20Austin%2C%20Texas%2C%20United%20States');
```

Given two listing URLs that differ only by tracking query/hash, assert normalized URL and SHA-256 fallback ID are identical.

- [ ] **Step 2: write failing browser-session lifecycle test**

Inject a fake Playwright launcher and assert `open()` applies headless/timeouts and returns isolated browser/context/page handles.

- [ ] **Step 3: run CI and verify RED**

Expected: missing browser modules/Playwright dependency.

- [ ] **Step 4: add `playwright: 1.62.1` and implement helpers/runtime**

Use the Playwright library package, not `@playwright/test`, for production automation.

- [ ] **Step 5: update CI browser install**

After frozen dependency install, add:

```yaml
- name: Install Playwright Chromium
  run: pnpm exec playwright install --with-deps chromium
```

This follows Playwright's supported CI/browser installation model.

- [ ] **Step 6: regenerate lockfile without weakening frozen CI and run full GREEN**

- [ ] **Step 7: commit**

Commit: `feat: add Playwright discovery runtime`.

---

### Task 3: Implement deterministic rendered Google Maps extraction with durable cursor

**Files:**
- Create: `packages/discovery/src/browser/maps-listing-extractor.ts`
- Create: `packages/discovery/src/browser/google-maps-browser.provider.ts`
- Create: `packages/discovery/src/browser/cursor.ts`
- Modify: `packages/discovery/src/index.ts`
- Create: `packages/discovery/test/fixtures/maps-results-page.html`
- Create: `packages/discovery/test/fixtures/maps-blocked-page.html`
- Create: `packages/discovery/test/google-maps-browser.provider.test.ts`
- Create: `packages/discovery/test/google-maps-browser.integration.test.ts`

**Cursor:**

```ts
interface GoogleMapsCursorV1 {
  v: 1;
  seenIds: string[];
  scrollRounds: number;
}
```

Validation limits:

```text
pageSize default 20, max 50
seenIds max 500
scrollRounds max 100
max empty scroll rounds 3
```

**Raw listing:**

```ts
export interface GoogleMapsBrowserListing {
  name: string;
  formattedAddress: string;
  category: string | null;
  listingUrl: string;
  latitude: number | null;
  longitude: number | null;
}
```

- [ ] **Step 1: write RED fixture extraction tests**

Serve fixture HTML from a local HTTP server or set page content in an injected page. Require extraction of two visible cards and no website/email/phone extraction.

- [ ] **Step 2: write RED continuation tests**

Page 1 returns two listings and a cursor containing their external IDs. `continueSearch()` reopens the search, skips those IDs, scrolls and returns the next unique listing. End-of-feed returns `nextCursor: null`.

- [ ] **Step 3: write RED blocked/access test**

Fixture with CAPTCHA/login/blocked markers must reject with `DiscoveryAccessBlockedError`; assert no attempt to click/solve the challenge.

- [ ] **Step 4: run CI and verify RED**

- [ ] **Step 5: implement deterministic extractor/provider**

Search text:

```ts
const place = input.geographicCell || input.city || input.region || input.country;
const searchText = `${input.query} in ${place}`;
```

Provider name:

```ts
readonly name = 'google-maps-browser';
```

Use rendered public anchors/cards and accessible labels. Do not inspect intercepted network responses for hidden business datasets.

- [ ] **Step 6: run real Chromium local-fixture integration GREEN**

- [ ] **Step 7: run full CI GREEN**

- [ ] **Step 8: commit**

Commit: `feat: discover businesses through Playwright`.

---

### Task 4: Add optional AI page interpretation without making AI the hot-path parser

**Files:**
- Create: `packages/discovery/src/browser/page-interpreter.ts`
- Create: `packages/discovery/src/browser/openai-page-interpreter.ts`
- Create: `packages/discovery/test/page-interpreter.test.ts`
- Create: `packages/discovery/test/openai-page-interpreter.test.ts`
- Modify: `packages/discovery/src/browser/google-maps-browser.provider.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/test/env.test.ts`
- Modify: `.env.example`

**Produces:**

```ts
export type BrowserPageKind =
  | 'RESULTS_PAGE'
  | 'NO_RESULTS'
  | 'BLOCKED_OR_CAPTCHA'
  | 'CONSENT_PAGE'
  | 'UNKNOWN_LAYOUT';

export interface BrowserPageInterpreter {
  interpret(input: {
    url: string;
    title: string;
    visibleText: string;
    accessibilitySnapshot: string;
  }): Promise<{ kind: BrowserPageKind; resultContainerHint?: string }>;
}
```

Environment:

```text
DISCOVERY_AI_MODEL=<optional>
OPENAI_API_KEY=<existing optional secret>
```

- [ ] **Step 1: write RED fallback invocation test**

Normal deterministic fixture succeeds and interpreter mock call count stays `0`.

Unknown-layout fixture invokes interpreter exactly once.

- [ ] **Step 2: write RED privacy/sanitization test**

Assert OpenAI adapter request contains only bounded `url`, `title`, visible text and accessibility snapshot; it must not accept/pass cookies, headers, localStorage, sessionStorage, or network payloads.

- [ ] **Step 3: write RED blocked classification test**

AI classification `BLOCKED_OR_CAPTCHA` must throw `DiscoveryAccessBlockedError`; no subsequent navigation/action is attempted.

- [ ] **Step 4: implement optional native-fetch OpenAI interpreter**

Do not add OpenAI SDK solely for this task. Use the existing `OPENAI_API_KEY` and configurable `DISCOVERY_AI_MODEL` only when both are configured. Standard CI uses mocked fetch and makes no paid request.

- [ ] **Step 5: run full CI GREEN**

- [ ] **Step 6: commit**

Commit: `feat: add AI browser page interpretation`.

---

### Task 5: Adapt discovery processor and worker composition to browser provider

**Files:**
- Modify: `apps/worker/src/business-discovery.processor.ts`
- Modify: `apps/worker/test/business-discovery.integration.test.ts`
- Create/Modify: `apps/worker/test/business-discovery.processor.test.ts`
- Modify: `apps/worker/src/job-worker.ts`
- Modify: `apps/worker/test/job-worker.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/package.json`
- Modify: `packages/config/src/env.ts`
- Modify: `.env.example`

**Environment defaults:**

```text
DISCOVERY_BROWSER_HEADLESS=true
DISCOVERY_BROWSER_CONCURRENCY=1
DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS=30000
DISCOVERY_BROWSER_ACTION_TIMEOUT_MS=10000
```

- [ ] **Step 1: write RED stale-job browser safety tests**

Paused/cancelled/version-stale jobs must return without provider invocation. This must happen before a browser is launched.

- [ ] **Step 2: write RED success persistence test with `nextCursor`**

Fake browser provider returns two listings and `nextCursor: null`; assert task COMPLETED, attempts/counters, candidates, sources and usage.

- [ ] **Step 3: write RED blocked-provider failure test**

`DiscoveryAccessBlockedError` marks only SearchTask FAILED, increments `errorCount` and `rateLimitCount` when `rateLimited=true`, leaves campaign DISCOVERING, and leaves unrelated task untouched.

- [ ] **Step 4: adapt processor from `nextPageToken/getNextPage` to `continuationCursor/continueSearch`**

- [ ] **Step 5: compose browser provider in worker startup**

Create one provider instance/registry from browser config. Register `campaign-discovery` unconditionally. Do not require a Google credential.

Browser concurrency is bounded to configured default `1`; no unbounded parallel browser launch.

- [ ] **Step 6: run full CI GREEN**

- [ ] **Step 7: commit**

Commit: `feat: run browser business discovery jobs`.

---

### Task 6: Verify crash-safe cursor continuation and pause/resume end-to-end

**Files:**
- Modify: `apps/worker/src/business-discovery.processor.ts`
- Modify: `apps/worker/test/business-discovery.integration.test.ts`
- Modify: `apps/api/test/campaigns.service.test.ts`

- [ ] **Step 1: write RED next-cursor scheduling test**

Provider page 1 returns `nextCursor = cursor-2`; assert SearchTask becomes PENDING, pageNumber 2, cursor persisted, and deterministic page-2 queue job scheduled.

- [ ] **Step 2: write RED committed-page enqueue-failure repair test**

Make page-2 enqueue fail after page-1 DB commit. Replay old page-1 queue payload and assert provider call count does not increase; processor only reschedules persisted page 2.

- [ ] **Step 3: write RED pause/resume generation sequence**

Old queued generation after PAUSE must not launch provider. Resume produces fresh planner generation, planner returns campaign to DISCOVERING, and fresh discovery generation invokes provider successfully.

- [ ] **Step 4: implement only missing repair/lifecycle behavior**

Do not add a new orchestration subsystem.

- [ ] **Step 5: run full CI GREEN**

- [ ] **Step 6: commit**

Commit: `test: verify resilient browser discovery lifecycle`.

---

### Task 7: Browser smoke, docs, security review, PR, merge

**Files:**
- Create: `packages/discovery/test/google-maps-browser.live.test.ts`
- Modify: `README.md`
- Create/Modify: `docs/milestones/STATUS.md`
- Review: full M3-main -> M4 diff.

- [ ] **Step 1: add opt-in live browser smoke**

Guard:

```ts
const live = process.env.RUN_LIVE_BROWSER_DISCOVERY_TESTS === '1' ? describe : describe.skip;
```

Run one narrow public browser query. If source presents CAPTCHA/login/blocking, the test reports blocked and stops; it must never automate bypass.

- [ ] **Step 2: document runtime**

README must explain Playwright/Chromium install, browser config, AI fallback, source/access limitations, diagnostics, continuation/retry behavior, and M5 boundary. Remove all Google Places API/key documentation.

- [ ] **Step 3: update milestone ledger**

Record M0-M3 complete, M4 as the current candidate, M5-M24 remaining in roadmap order.

- [ ] **Step 4: exact-head full verification**

Require:

```text
frozen install
Playwright Chromium install
Prisma validation
all migrations
unit tests
real Chromium local-fixture integration
worker/database pg-boss integration
typecheck
lint
build
compiled smoke-start
```

- [ ] **Step 5: final code/security review**

Reject the candidate if any of these remain:

- `GOOGLE_PLACES_API_KEY` or Places API URL/field mask/SDK usage.
- hidden Maps network/data endpoint extraction.
- CAPTCHA/access-control bypass logic.
- stealth/fingerprint/proxy-rotation/evasion code.
- browser cursor only in memory/queue.
- stale jobs can launch browser/AI.
- unbounded browser concurrency.
- provider-specific campaign/domain orchestration.
- M5+ scope creep.
- forbidden queue infrastructure.

Fix Critical/Important findings and rerun exact-head verification.

- [ ] **Step 6: open PR**

Title: `Milestone 4: Browser business discovery`

Require PR CI on the exact reviewed head.

- [ ] **Step 7: squash merge with expected-head SHA guard**

- [ ] **Step 8: verify post-merge `main` CI**

Do not mark M4 complete or start M5 until the merge-triggered `main` workflow passes every required gate.
