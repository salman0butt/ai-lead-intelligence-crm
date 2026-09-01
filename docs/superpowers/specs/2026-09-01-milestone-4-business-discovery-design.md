# Milestone 4 Business Discovery Design

## Goal

Introduce real, provider-isolated business discovery over the durable `SearchTask` search space created in Milestone 3. A campaign must be able to discover actual businesses through one real provider while provider failures, retries, pagination, pause/resume, and worker restarts remain durable.

## Source contract

The master roadmap requires:

- `packages/discovery`.
- a `BusinessDiscoveryProvider` interface with `searchBusinesses()`, `getNextPage()`, and `normalizeResult()`.
- no tight coupling of domain/workers to Google.
- one real provider first.
- `BusinessCandidate`, `BusinessSource`, and `ProviderUsage` persistence.
- a business-discovery workflow that processes `SearchTask`, calls the provider, normalizes/stores candidates, and schedules pagination.
- provider usage tracking for provider, requests, results, errors, known cost, 429s, campaign, and workspace.
- acceptance that a real campaign can discover actual businesses, results are normalized, provider code is isolated, and provider failures do not crash the campaign.

## Milestone boundary

M4 includes discovery and candidate persistence only.

M4 explicitly excludes:

- canonical `Business` deduplication (M5).
- official domain resolution and website verification (M6).
- crawling (M7).
- contact enrichment (M8).
- website technology/audit (M9).
- AI/LangGraph research (M10+).
- result/filter UI (M16).

Small lifecycle changes required to make discovery resumable are in scope.

## Provider architecture

Create `packages/discovery` as a provider-neutral TypeScript package with no Prisma or pg-boss dependency.

### Provider contract

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
  nextPageToken: string | null;
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
  getNextPage(input: BusinessSearchInput, pageToken: string): Promise<BusinessDiscoveryPage<TRaw>>;
  normalizeResult(raw: TRaw): NormalizedBusiness;
}
```

The provider package owns provider HTTP semantics and normalization only. It does not write to PostgreSQL and does not schedule jobs.

### Provider registry

Add a small `DiscoveryProviderRegistry` that maps provider name to provider instance. A missing configured provider throws a clear configuration error only when a discovery job requires it; the worker process itself must still start in CI and development without a Google key.

## Google Places adapter

Implement `GooglePlacesDiscoveryProvider` using Places API (New) Text Search:

```text
POST https://places.googleapis.com/v1/places:searchText
```

Use native `fetch`; do not add a Google SDK.

Required headers:

```text
Content-Type: application/json
X-Goog-Api-Key: <server-only key>
X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.primaryType,places.location,nextPageToken
```

Use `pageSize: 20` by default.

Build a deterministic text query from the M3 task:

```text
<query> in <city | region | country>
```

If `geographicCell` is non-empty, it is the most specific geography label.

Pagination uses the same search input plus the previous response `nextPageToken` as request `pageToken`. All search parameters remain the same across pages except the allowed page controls.

The adapter must:

- parse successful JSON responses.
- return an empty result list when `places` is absent.
- require `place.id` to normalize a result.
- map `displayName.text`, `formattedAddress`, `primaryType`, and coordinates.
- expose a stable `rawReference` such as `google-place:<place-id>`.
- throw a typed `DiscoveryProviderError` on non-2xx responses with `statusCode` and `rateLimited = statusCode === 429`.

No Google-specific response shape escapes `packages/discovery` except as the generic raw result type used for provenance storage.

## Configuration

Add optional server-only:

```text
GOOGLE_PLACES_API_KEY
```

to `@ai-crm/config` and `.env.example`.

The environment schema keeps the value optional so normal API/worker startup and CI do not require a paid provider credential. `GooglePlacesDiscoveryProvider` construction requires a non-empty key.

Never expose the key through the web application or API responses.

## Persistence

### BusinessCandidate

Persist normalized provider candidates separately from the canonical `Business` entity that M5 will introduce.

Fields:

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

This suppresses exact same-provider duplicates caused by overlapping `SearchTask`s without performing M5 cross-provider/fuzzy canonical deduplication.

### BusinessSource

Preserve provenance between a candidate and the search task that discovered it.

Fields:

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

A retry of the same task/page therefore does not create duplicate provenance.

### ProviderUsage

Aggregate provider usage per campaign/provider:

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

Uniqueness:

```text
campaignId + provider
```

`costAmount` remains null when cost cannot be reliably determined. M4 does not hard-code Google SKU pricing.

### SearchTask discovery cursor

Extend `SearchTask` with:

```text
nextPageToken nullable
pageNumber Int default 1
```

The provider cursor is PostgreSQL state, not queue-only state. This makes pagination repairable after crashes, pauses, or enqueue failures.

## Campaign lifecycle

Add the M4 phase status:

```text
DISCOVERING
```

Existing statuses remain:

```text
DRAFT
PLANNING
PAUSED
CANCELLED
```

M4 does not add later `ENRICHING`/`RESEARCHING` phases yet.

Lifecycle behavior:

- start: `DRAFT -> PLANNING`, enqueue a versioned `campaign-plan` job.
- campaign-plan after durable planning: conditionally transition `PLANNING -> DISCOVERING`, then schedule pending SearchTasks.
- pause: `PLANNING | DISCOVERING -> PAUSED`.
- resume: `PAUSED -> PLANNING`, enqueue a fresh versioned `campaign-plan`; M3 replay reuses the SearchPlan/tasks and M4 reschedules only unfinished discovery work.
- cancel: `DRAFT | PLANNING | DISCOVERING | PAUSED -> CANCELLED`.

The campaign `updatedAt` timestamp is the execution generation. Every discovery job includes `campaignVersion = campaign.updatedAt.toISOString()` from the `DISCOVERING` campaign row.

Before any external request, the discovery worker reloads the campaign and requires:

```text
status == DISCOVERING
campaign.updatedAt.toISOString() == payload.campaignVersion
```

If either check fails, the queued job is stale and exits without calling the provider. This makes pause/resume/cancel immediately invalidate already queued discovery work without needing queue-wide cancellation.

## Queue contracts

Keep the established queue name:

```text
campaign-discovery
```

Do not add a second application queue called `business-discovery`.

The processor/module may be named `business-discovery.processor.ts` while consuming `campaign-discovery`.

### campaign-plan payload

Remain identifier-oriented:

```text
jobId
workspaceId
campaignId
```

The idempotency key becomes versioned so resume can publish a fresh planner replay:

```text
campaign-plan:<campaignId>:<campaign-updatedAt-iso>
```

### campaign-discovery payload

```text
jobId
workspaceId
campaignId
searchTaskId
campaignVersion
pageNumber
```

All values are small strings because `QueuePayloadInput` currently permits string values only.

Idempotency key:

```text
campaign-discovery:<searchTaskId>:<campaignVersion>:page:<pageNumber>
```

## Planning-to-discovery handoff

After `planCampaignSearch()` creates/reuses the durable task space, the production `campaign-plan` processor:

1. reloads the campaign.
2. exits without scheduling if `PAUSED` or `CANCELLED`.
3. transitions `PLANNING -> DISCOVERING` with a conditional update, or accepts an already-`DISCOVERING` campaign during replay.
4. reads unfinished SearchTasks (`PENDING`, `FAILED`) for the campaign plan.
5. schedules one idempotent `campaign-discovery` job per task at its persisted `pageNumber`.

Scheduling may happen in bounded batches but each job receives its own idempotency key.

A partial scheduling failure causes the campaign-plan job to fail and pg-boss retry. On replay, already scheduled jobs are returned through idempotency and missing jobs are created.

## Discovery processor

Create `apps/worker/src/business-discovery.processor.ts`.

The processor runs inside the existing `processTrackedJob()` wrapper so queue-level attempts/failures remain visible through `JobMetadata`.

### Stale-job checks

Before provider I/O:

- load SearchTask with SearchPlan/Campaign.
- require payload workspace/campaign/task identifiers to match persisted relations.
- require campaign status/version to match as described above.
- completed/cancelled task => successful no-op.
- payload `pageNumber` lower than persisted `SearchTask.pageNumber` => provider call already committed; repair scheduling for the persisted current page if a token remains, then return.
- payload `pageNumber` higher than persisted page => reject as inconsistent.

### Claim and attempt tracking

For the current page, conditionally transition:

```text
PENDING | FAILED -> RUNNING
```

and increment `attemptCount`.

A stale concurrent claim exits without duplicate provider I/O.

### Provider call

Build `BusinessSearchInput` from the SearchTask.

- page 1 with no persisted token: `searchBusinesses()`.
- later page: require persisted `nextPageToken` and call `getNextPage()`.

Increment `ProviderUsage.requestCount` immediately before external I/O.

On provider error:

- increment `errorCount`.
- increment `rateLimitCount` for typed 429 failures.
- transition task `RUNNING -> FAILED` and preserve its cursor/page.
- rethrow so pg-boss owns retry/backoff/DLQ.

Other campaign SearchTasks continue independently; one provider failure does not transition the campaign itself to `FAILED`.

### Result transaction

Normalize every raw provider result.

Inside one database transaction:

1. upsert `BusinessCandidate` by campaign/provider/providerExternalId.
2. create/upsert `BusinessSource` provenance for candidate + SearchTask.
3. increment `SearchTask.resultCount` by provider result count.
4. increment `SearchTask.uniqueBusinessCount` only by newly created candidate-task provenance edges.
5. write `nextPageToken`.
6. if a next page exists: increment `pageNumber`, return task to `PENDING`.
7. otherwise: set task `COMPLETED` and clear cursor.
8. increment `ProviderUsage.resultCount` by provider result count.

Existing candidate/source records make result persistence idempotent.

### Crash-safe pagination repair

If page-N result persistence succeeds but enqueueing page N+1 fails:

- throw the scheduling failure so pg-boss retries page N's queue job.
- on retry, the persisted SearchTask is already at page N+1.
- the stale-page check detects payload page N < persisted page N+1.
- it schedules the persisted current page using the stored token and deterministic idempotency key.
- it does **not** call the provider for page N again.

This prevents both lost pagination and avoidable provider cost.

## Worker composition

`registerJobWorkers()` registers:

```text
system-test
campaign-plan
campaign-discovery
```

Worker startup constructs a `DiscoveryProviderRegistry`. Google is registered only when `GOOGLE_PLACES_API_KEY` is configured. Missing provider configuration does not stop worker boot; a discovery job requiring the missing provider fails clearly and follows queue retry/DLQ behavior.

## Testing strategy

### packages/discovery unit tests

Use injected `fetch` to verify:

- first-page request endpoint/method/body/headers/field mask.
- next-page request preserves query/search parameters and adds page token.
- normalization of ID/name/address/category/location.
- missing `places` -> empty page.
- non-2xx -> typed provider error.
- 429 -> `rateLimited = true`.

No real quota is spent by normal CI.

### database integration tests

Verify:

- new models and relations.
- exact candidate uniqueness.
- source uniqueness.
- usage defaults.
- SearchTask cursor defaults.

### worker service/integration tests

Verify:

- campaign-plan transitions to DISCOVERING and schedules unfinished tasks with identifier-only/versioned payloads.
- pause/cancel invalidates stale queued discovery jobs before provider I/O.
- resume publishes a new planner generation.
- one discovery page normalizes/stores candidates and provenance.
- duplicate provider results across tasks do not duplicate the same exact candidate.
- pagination stores cursor/page and schedules the next job.
- replay after committed page does not re-call provider and repairs missing next-page scheduling.
- provider error marks task FAILED and increments usage.
- 429 increments rate-limit usage.
- one failed task does not cancel unrelated tasks/campaign.
- an independently started pg-boss worker can consume a persisted `campaign-discovery` job using an injected deterministic provider fixture and persist candidates.

### live provider test

Add an opt-in test guarded by:

```text
GOOGLE_PLACES_API_KEY
RUN_LIVE_DISCOVERY_TESTS=1
```

It performs one narrow real Text Search against a stable broad query and verifies at least one normalized business. It is skipped in standard CI unless both values are configured.

## Acceptance criteria

M4 is complete when:

- `packages/discovery` owns the provider abstraction and Google Places implementation.
- normal CI needs no paid provider secret.
- an opt-in real Google request can return and normalize actual businesses.
- BusinessCandidate, BusinessSource, ProviderUsage, and SearchTask cursor state are durable in PostgreSQL.
- campaign-plan schedules durable discovery work after planning.
- campaign-discovery independently processes SearchTasks and pagination.
- duplicate exact Google candidates are not repeatedly persisted within one campaign.
- provenance is retained.
- provider usage/errors/429s are tracked.
- page persistence + enqueue failure is recoverable without repeating the prior provider page.
- pause/resume/cancel invalidate stale jobs before provider I/O.
- provider-specific code stays outside campaign/domain orchestration.
- a provider failure does not crash/cancel the whole campaign.
- frozen install, Prisma validation/migrations, tests, typecheck, lint, build, and compiled smoke-start pass on the exact merge candidate.
