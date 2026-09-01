# Milestone 4 Business Discovery Design

## Goal

Introduce real, provider-isolated business discovery over the durable `SearchTask` search space created in Milestone 3, using public browser-accessible search surfaces through Playwright rather than paid business-data APIs.

The first production source is Google Maps browser discovery. The design must remain source-neutral so later permitted directories, search pages, or business listing sites can be added without changing campaign orchestration.

## Source contract

The master roadmap requires:

- `packages/discovery`.
- a `BusinessDiscoveryProvider` abstraction.
- no provider-specific code in campaign/domain orchestration.
- one real discovery source first.
- `BusinessCandidate`, `BusinessSource`, and `ProviderUsage` persistence.
- a discovery worker that processes `SearchTask`, normalizes/stores candidates, and resumes durable continuation work.
- provider/source usage tracking.
- provider/source failures must not crash the campaign.

The user explicitly requires browser discovery rather than Google Places API usage.

## Milestone boundary

M4 includes discovery and candidate persistence only.

M4 explicitly excludes:

- canonical cross-source/fuzzy `Business` deduplication (M5).
- official domain resolution and website verification (M6).
- website crawling (M7).
- contact enrichment (M8).
- website technology/audit (M9).
- lead research/report generation (M10+).
- results/filter UI (M16).

Browser navigation/extraction intelligence used only to discover business listings is part of M4 and is not M10 lead research.

## Safety and access rules

Browser discovery may use only pages that are publicly accessible to the configured browser session.

The implementation must not:

- bypass CAPTCHA or anti-bot challenges.
- defeat login/access controls.
- rotate identities/proxies to evade blocking.
- circumvent paywalls or technical restrictions.
- call undocumented Google Maps internal data endpoints as a substitute for browser extraction.

If the source presents a CAPTCHA, blocked-access page, login wall, or equivalent challenge, the browser provider stops the current attempt and returns a typed blocked/access error. Queue retry/backoff may retry later, but the code must not automate challenge solving or evasion.

Deployments are responsible for enabling browser sources whose terms permit the intended automation. The source adapter remains replaceable for this reason.

## Provider architecture

Keep `packages/discovery` as a provider-neutral TypeScript package with no Prisma or pg-boss dependency.

### Provider contract

Replace API-specific page-token terminology with a generic continuation cursor:

```ts
export interface BusinessSearchInput {
  query: string;
  country: string;
  region: string;
  city: string;
  geographicCell: string;
  pageSize?: number;
}

export interface BusinessDiscoveryPage<TRaw> {
  results: readonly TRaw[];
  nextCursor: string | null;
}

export interface NormalizedBusiness {
  providerExternalId: string;
  name: string;
  formattedAddress: string;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  rawReference: string | null;
}

export interface BusinessDiscoveryProvider<TRaw = unknown> {
  readonly name: string;
  searchBusinesses(input: BusinessSearchInput): Promise<BusinessDiscoveryPage<TRaw>>;
  continueSearch(input: BusinessSearchInput, cursor: string): Promise<BusinessDiscoveryPage<TRaw>>;
  normalizeResult(raw: TRaw): NormalizedBusiness;
  close?(): Promise<void>;
}
```

The provider package owns source/browser semantics and normalization only. It does not write PostgreSQL rows and does not schedule pg-boss jobs.

### Provider registry

`DiscoveryProviderRegistry` maps stable provider names to provider instances.

The new production provider name is:

```text
google-maps-browser
```

M4 migration converts any pre-existing M3 `SearchTask.provider = 'google-places'` rows to `google-maps-browser`, and the M3 planner default is updated so new tasks use the new name.

## Browser subsystem

Use Playwright `1.62.1` as the pinned browser automation library. Standard CI installs Chromium explicitly with Playwright's supported browser-install command because Playwright packages do not download browser binaries during normal dependency installation.

The browser subsystem is split into focused units:

```text
BrowserSessionFactory
    -> launches Chromium/context/page with bounded timeouts
GoogleMapsBrowserProvider
    -> constructs search URL, drives result feed, extracts public listing cards
MapsListingExtractor
    -> deterministic DOM/accessibility extraction
BrowserPageInterpreter
    -> optional AI-guided recovery when deterministic extraction cannot understand a changed page
```

### BrowserSessionFactory

Responsibilities:

- launch Chromium headless by default.
- create isolated browser contexts per discovery execution/session.
- set navigation/action timeouts.
- expose a controlled user-agent/locale without impersonation tricks.
- close pages/contexts/browsers on success or failure.
- optionally capture screenshot/HTML diagnostics into a configured local diagnostics directory on provider errors.

M4 does not implement stealth plugins, fingerprint spoofing, proxy rotation, or CAPTCHA solvers.

### Google Maps browser navigation

The provider opens the normal public browser search surface with an encoded query such as:

```text
https://www.google.com/maps/search/?api=1&query=Dentist%20in%20Austin%2C%20Texas%2C%20United%20States
```

This URL is used only to navigate the browser UI; data must be extracted from rendered page content/accessibility DOM rather than Google Places API or hidden Maps data endpoints.

The provider builds search text from the most specific geography:

```ts
const place = input.geographicCell || input.city || input.region || input.country;
const searchText = `${input.query} in ${place}`;
```

### Deterministic extraction first

For cost, speed, and reproducibility, normal discovery uses deterministic Playwright locators and DOM/accessibility extraction first.

The extractor looks for the rendered results feed and visible/public listing anchors/cards, and extracts only M4 fields:

- business/listing name.
- formatted address when present in the listing card/detail surface.
- category when present.
- canonical public Maps listing URL/reference.
- coordinates only if they are directly available from the canonical public URL/rendered surface without calling hidden data services; otherwise null.

M4 must not extract website, email, or phone merely because the Maps detail page exposes them; those belong to later milestones.

### Stable browser listing identity

Browser discovery does not assume a Google Places API `place_id`.

For each rendered listing:

1. normalize its public Maps listing URL by removing search/tracking-only query parameters and fragments.
2. use an explicit stable public identifier from the canonical URL only when one is clearly available.
3. otherwise compute a SHA-256 digest of the normalized canonical Maps URL.

`providerExternalId` is therefore stable within the browser source without requiring a paid/undocumented API.

Example fallback:

```text
maps-url-sha256:<hex>
```

`rawReference` stores the normalized canonical public Maps URL.

## AI-guided browser interpretation

AI is an optional recovery/interpretation layer, not the primary per-record parser.

Define:

```ts
export interface BrowserPageInterpreter {
  interpret(input: {
    url: string;
    title: string;
    visibleText: string;
    accessibilitySnapshot: string;
  }): Promise<BrowserInterpretation>;
}
```

`BrowserInterpretation` may classify:

```text
RESULTS_PAGE
NO_RESULTS
BLOCKED_OR_CAPTCHA
CONSENT_PAGE
UNKNOWN_LAYOUT
```

and may return semantic hints describing which visible result container/listing labels should be used.

Production composition can register an AI interpreter when an AI credential/model is configured. The initial AI adapter uses the existing server-side `OPENAI_API_KEY` through a narrow structured-output call; no Google API key is introduced.

Important constraints:

- AI never receives cookies, auth headers, browser storage, or unrelated page data.
- AI sees a bounded sanitized accessibility/text snapshot, not arbitrary hidden DOM/network payloads.
- AI is called only after deterministic recognition/extraction fails or the page state is ambiguous.
- AI may identify a blocked/CAPTCHA page but must never propose or execute challenge bypass.
- deterministic tests use a fake interpreter; standard CI needs no AI credential and performs no paid AI calls.

If no AI interpreter is configured and deterministic extraction encounters an unknown layout, the provider fails clearly and lets queue retry/error handling apply.

## Browser continuation cursor

Google Maps uses infinite scrolling, so `nextPageToken` is replaced by a provider-neutral `continuationCursor` persisted on `SearchTask`.

For `google-maps-browser`, the cursor is a versioned JSON string such as:

```json
{
  "v": 1,
  "seenIds": ["maps-url-sha256:..."],
  "scrollRounds": 4
}
```

Rules:

- cursor JSON is validated before use.
- `seenIds` contains only provider external IDs for this SearchTask and is capped to a documented maximum.
- continuation reopens the public search URL in a fresh browser context, scrolls the feed, skips already-seen IDs, and collects up to `pageSize` new unique listings.
- exact candidate/source database uniqueness still protects against result-order changes and overlap.
- if the feed clearly reaches its end or no new unique listings appear after a bounded number of scroll rounds, `nextCursor` is null and the SearchTask completes.

No correctness requirement depends on preserving an in-memory page between queue jobs.

## Persistence

### BusinessCandidate

Persist normalized browser-source candidates separately from the canonical `Business` entity that M5 will introduce.

Fields remain:

```text
id UUID
workspaceId UUID
campaignId UUID
provider
providerExternalId
name
formattedAddress
category nullable
latitude nullable
longitude nullable
rawReference nullable
createdAt
updatedAt
```

Uniqueness:

```text
campaignId + provider + providerExternalId
```

### BusinessSource

Preserve provenance between a candidate and the SearchTask that discovered it.

Fields remain:

```text
id UUID
businessCandidateId UUID
searchTaskId UUID
provider
providerExternalId
rawPayload JSON
createdAt
```

Uniqueness:

```text
businessCandidateId + searchTaskId
```

### ProviderUsage

The existing model remains but represents discovery-source usage, not API billing only:

```text
id UUID
workspaceId UUID
campaignId UUID
provider
requestCount
resultCount
errorCount
rateLimitCount
costAmount nullable Decimal(18,6)
costCurrency nullable varchar(3)
createdAt
updatedAt
```

For browser discovery:

- `requestCount` increments once per browser discovery attempt/page execution.
- `resultCount` counts rendered source results returned by the provider.
- `errorCount` counts provider/browser failures.
- `rateLimitCount` counts typed browser blocking/throttling responses when detectable.
- `costAmount` stays null in M4 unless an AI interpreter later provides explicit measurable model usage accounting.

### SearchTask cursor

Use:

```text
continuationCursor nullable Text
pageNumber Int default 1
```

The browser continuation state is PostgreSQL state, not in-memory browser state or queue-only state.

## Campaign lifecycle

Keep the M4 `DISCOVERING` status and the already-designed lifecycle:

```text
DRAFT -> PLANNING -> DISCOVERING
PLANNING | DISCOVERING -> PAUSED
PAUSED -> PLANNING
DRAFT | PLANNING | DISCOVERING | PAUSED -> CANCELLED
```

The campaign `updatedAt` timestamp remains the execution generation.

Before any browser or AI I/O, the discovery worker must require:

```text
campaign.status == DISCOVERING
campaign.updatedAt.toISOString() == payload.campaignVersion
```

Stale jobs exit without launching a browser.

## Queue contracts

Keep the established queue name:

```text
campaign-discovery
```

Payload remains identifier-oriented:

```text
jobId
workspaceId
campaignId
searchTaskId
campaignVersion
pageNumber
```

Idempotency remains:

```text
campaign-discovery:<searchTaskId>:<campaignVersion>:page:<pageNumber>
```

Browser cursor data never travels as the queue source of truth.

## Planning-to-discovery handoff

Keep the existing M4 handoff already implemented on the feature branch:

1. planner creates/reuses SearchPlan/SearchTasks.
2. campaign transitions `PLANNING -> DISCOVERING`.
3. unfinished SearchTasks are scheduled independently.
4. replay uses deterministic idempotency.
5. pause/cancel winning a race prevents new work from being scheduled.

Change only the default provider from `google-places` to `google-maps-browser`.

## Discovery processor

Keep the existing worker-side persistence/orchestration design and make it cursor-neutral.

Before source I/O:

- load SearchTask with SearchPlan/Campaign.
- validate workspace/campaign/task identity.
- validate campaign status/version.
- completed/cancelled task => no-op.
- stale lower page => repair scheduling from persisted current page/cursor.
- higher-than-persisted page => reject.
- claim `PENDING | FAILED -> RUNNING` and increment attemptCount.

Provider call:

- first page without cursor: `searchBusinesses()`.
- later page: require `continuationCursor` and call `continueSearch()`.

Result transaction:

1. normalize each rendered listing.
2. upsert candidate by campaign/provider/providerExternalId.
3. upsert provenance candidate+SearchTask.
4. increment result counters.
5. persist `nextCursor` into `continuationCursor`.
6. if cursor exists: increment pageNumber and return task to PENDING.
7. otherwise: mark task COMPLETED and clear cursor.
8. update ProviderUsage.

A browser/source failure marks only that SearchTask FAILED, increments ProviderUsage errors/rate-limit counters as appropriate, and rethrows to pg-boss. It does not fail/cancel the campaign or unrelated tasks.

## Crash-safe continuation repair

If result persistence commits page N and page N+1 scheduling fails:

- PostgreSQL already contains page N+1 plus `continuationCursor`.
- the current queue job fails so pg-boss retries.
- replay sees payload page N < persisted page N+1.
- it schedules the persisted page N+1 using the deterministic idempotency key.
- it does not reopen/reprocess page N.

## Worker composition and concurrency

`registerJobWorkers()` registers:

```text
system-test
campaign-plan
campaign-discovery
```

Worker startup constructs the browser provider without any Google API credential.

Browser concurrency must be bounded independently of pg-boss queue throughput. M4 starts conservatively with a configurable per-worker browser concurrency default of `1`.

Recommended environment:

```text
DISCOVERY_BROWSER_HEADLESS=true
DISCOVERY_BROWSER_CONCURRENCY=1
DISCOVERY_BROWSER_NAVIGATION_TIMEOUT_MS=30000
DISCOVERY_BROWSER_ACTION_TIMEOUT_MS=10000
DISCOVERY_AI_MODEL=<optional model>
```

`OPENAI_API_KEY` remains optional and is used only when the optional AI page interpreter is enabled/configured.

There is no `GOOGLE_PLACES_API_KEY`.

## Testing strategy

### Discovery package unit tests

Use local deterministic HTML/DOM fixtures and injected browser/page abstractions to verify:

- search URL/query construction.
- visible results feed extraction.
- stable canonical URL identity/hash fallback.
- fields normalize to provider-neutral output.
- scrolling collects bounded new unique results.
- continuation cursor serialization/validation.
- continuation skips already-seen IDs.
- end-of-feed produces null cursor.
- CAPTCHA/blocked/login page classification produces typed access error and never attempts bypass.
- unknown layout invokes fake AI interpreter only when configured.
- AI interpreter is never called on normal deterministic extraction success.

### Browser integration tests

Standard CI installs Chromium and runs Playwright against local fixture pages served from the test process. No live Google or AI credential is required.

The fixture integration test must exercise a real Chromium instance, scrollable result feed, listing extraction, cursor continuation, and browser cleanup.

Playwright's official CI guidance requires installing browser binaries/dependencies explicitly; CI will run the documented Chromium install command before tests. citeturn124774search0turn124774search1

### Worker/database integration tests

Keep and adapt the existing M4 tests for:

- campaign-plan -> DISCOVERING durable scheduling.
- stale pause/cancel jobs avoid browser/provider I/O.
- successful browser-provider page persists candidates/provenance/counters.
- duplicate exact listing IDs across tasks do not duplicate BusinessCandidate.
- cursor continuation schedules next page.
- committed-page replay repairs missing scheduling without repeating source I/O.
- blocked/rate-limited provider error marks only the SearchTask failed and updates usage.
- independent pg-boss worker can consume a discovery job with an injected deterministic browser provider fixture.

### Opt-in live browser smoke

A live browser smoke test may be guarded by:

```text
RUN_LIVE_BROWSER_DISCOVERY_TESTS=1
```

It may open the public configured source, run one narrow query, and verify at least one normalized listing only when the environment permits it.

The live test must fail/stop rather than bypass CAPTCHA, login, consent/access restrictions, or blocking. It is not part of normal CI and is not required for merge when the external site is unavailable or disallows automation.

## Acceptance criteria

M4 is complete when:

- no Google Places API code, key, SDK, field mask, or API request remains.
- `packages/discovery` owns the provider-neutral browser discovery abstraction.
- the M3 planner produces `google-maps-browser` SearchTasks and migration upgrades legacy `google-places` task labels.
- Playwright Chromium can discover and normalize businesses from deterministic rendered browser fixtures in CI.
- the real provider drives the public browser surface rather than a business-data API.
- deterministic extraction is primary; optional AI interpretation is isolated and only used for ambiguous/changed page states.
- CAPTCHA/login/access-control bypass is explicitly absent.
- BusinessCandidate, BusinessSource, ProviderUsage, and continuation cursor state are durable in PostgreSQL.
- campaign-plan schedules durable discovery work after planning.
- campaign-discovery independently processes SearchTasks and continuation.
- exact browser listing candidates are not repeatedly persisted within a campaign.
- provenance is retained.
- usage/errors/blocking events are tracked.
- committed-page + enqueue failure is recoverable without replaying the prior browser page's persistence.
- pause/resume/cancel invalidate stale jobs before browser/AI I/O.
- source-specific code stays outside campaign/domain orchestration.
- source failure does not crash/cancel the whole campaign.
- frozen install, Prisma validation/migrations, unit/integration tests, typecheck, lint, build, Chromium-backed fixture tests, and compiled smoke-start pass on the exact merge candidate.
