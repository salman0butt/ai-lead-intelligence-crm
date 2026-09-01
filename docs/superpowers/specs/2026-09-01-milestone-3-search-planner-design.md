# Milestone 3 Search Planner Design

## Goal

Transform a large campaign target into a durable, resumable search plan made of smaller `SearchTask` records without performing real business discovery yet.

## Scope

Milestone 3 includes:

- `SearchPlan` persistence linked one-to-one with a campaign.
- `SearchTask` persistence for provider/query/geography search space.
- deterministic niche expansion, including the agreed Dentist expansion set.
- a geography abstraction that can expand a country into regions/states and preserve explicit region/city targeting.
- a production `campaign-plan` worker implementation that generates search tasks from the persisted campaign.
- database-level duplicate suppression so queue retries or planner reruns do not recreate completed search space.
- task execution state and counters required for later resumable discovery.
- unit and PostgreSQL-backed integration coverage for planning, retry safety, and independent worker handoff.

Milestone 3 explicitly does not include:

- real Google Places/OpenStreetMap/directory/provider API calls.
- business candidate persistence or lead normalization.
- provider pagination.
- enrichment, website crawling, AI research, or outreach generation.
- AI-based niche expansion.
- new frontend pages or campaign CRUD behavior unrelated to planning.

Those belong to Milestone 4 and later milestones.

## Data Model

### SearchTaskStatus

Add:

- `PENDING`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

M3 only creates `PENDING` tasks. The additional execution states make persisted tasks resumable by the M4 discovery worker without redesigning the table.

### SearchPlan

Fields:

- `id: UUID`
- `workspaceId: UUID`
- `campaignId: UUID`, unique
- `createdAt`
- `updatedAt`

Relations:

- belongs to one workspace.
- belongs to one campaign.
- has many search tasks.
- deleting a campaign or workspace cascades the plan.

There is exactly one `SearchPlan` per campaign. Planner retries reuse it.

### SearchTask

Fields required by the milestone contract:

- `country`
- `region`
- `city`
- `geographicCell`
- `query`
- `provider`
- `status`
- `attemptCount`
- `resultCount`
- `uniqueBusinessCount`

Persistence fields:

- `id: UUID`
- `searchPlanId: UUID`
- `createdAt`
- `updatedAt`

`region`, `city`, and `geographicCell` are persisted as normalized non-null strings; an empty string represents an unspecified level. This lets PostgreSQL enforce duplicate suppression without nullable-column uniqueness gaps.

Defaults:

- `status = PENDING`
- `attemptCount = 0`
- `resultCount = 0`
- `uniqueBusinessCount = 0`

Indexes:

- `(searchPlanId, status)` for resumable discovery scans.
- unique `(searchPlanId, provider, country, region, city, query)` for the required search-space duplicate rule.

`geographicCell` is persisted for future subregion/cell planning but is not part of the M3 uniqueness rule because the original milestone contract defines uniqueness as provider + country + region + city + query.

## Planner Architecture

Planning logic lives under `apps/worker/src/search-planner/`, not in `CampaignsService`.

The subsystem has three focused units:

1. `niche-expander.ts` — deterministic query expansion only.
2. `geography.ts` — geography abstraction and the initial deterministic catalog.
3. `search-planner.ts` — loads campaign state, builds the search-space Cartesian product, and persists it transactionally.

No network calls occur in the planner.

## Deterministic Niche Expansion

The default expansion preserves stable ordering and removes case-insensitive duplicates.

For `Dentist`, the required default queries are:

1. `Dentist`
2. `Dental Clinic`
3. `Family Dentist`
4. `Cosmetic Dentist`
5. `Orthodontist`
6. `Pediatric Dentist`
7. `Emergency Dentist`

Known aliases such as `dentists` normalize to the same expansion. Unknown niches fall back to the trimmed campaign niche itself rather than inventing AI-generated variants.

AI niche expansion is deferred until OpenAI infrastructure exists in a later milestone.

## Geography Abstraction

Define a `GeographyCatalog` interface that receives:

- country
- optional region
- optional city

and returns normalized geographic targets:

- country
- region
- city
- geographicCell

Rules for the initial catalog:

- explicit city: preserve that exact country/region/city as one target.
- explicit region without city: preserve that country/region as one target.
- United States country-only targeting: expand into the 50 states plus District of Columbia.
- other country-only targeting: produce one country-level target.

This gives the agreed 10,000-lead United States example a large deterministic search space without embedding geography decisions in campaign services. The catalog interface is the replacement point for a licensed or fuller geographic dataset later.

No fake city names or fabricated subregions are generated.

## Provider Identifier

M3 persists `provider = "google-places"` as the initial planned provider identifier.

This is only an identifier used to partition and deduplicate search space. M3 does not call Google APIs and does not add provider credentials or SDKs. M4 will introduce the real `BusinessDiscoveryProvider` abstraction and can change provider selection independently of planner persistence.

## Planning Flow

The existing M2 start flow remains the entry point:

1. authenticated API transitions campaign `DRAFT -> PLANNING`.
2. API enqueues durable `campaign-plan` with `{ workspaceId, campaignId }`.
3. independent worker receives the job.
4. tracked-job wrapper records queue attempt lifecycle.
5. planner loads the campaign by both `campaignId` and `workspaceId`.
6. cancelled campaign: planning exits successfully without creating search space.
7. draft campaign: planner rejects the inconsistent state so the queue retry/failure path is visible.
8. planning or paused campaign: planner expands niche and geography.
9. planner creates the Cartesian product of provider × query × geography and removes in-memory duplicates.
10. inside one PostgreSQL transaction, planner upserts the campaign's `SearchPlan` and `createMany(..., skipDuplicates: true)` for `SearchTask` rows.
11. tracked job records completion.

Planning is allowed while a campaign is `PAUSED` because creating durable search space performs no external discovery work. This preserves M2 resume semantics: resuming does not need to publish a second planning job.

## Resumability and Duplicate Safety

The planner must be safe under:

- pg-boss retry.
- worker restart.
- duplicate planner invocation.
- application-level replay.

Safety rules:

- `SearchPlan.campaignId` is unique, so retries reuse the same plan.
- SearchTask composite uniqueness defines completed search space.
- `createMany(..., skipDuplicates: true)` inserts only missing tasks.
- planner reruns never update an existing task's `status`, `attemptCount`, `resultCount`, or `uniqueBusinessCount`.
- therefore a previously completed task remains completed and is not repeated unnecessarily.

The planner returns counts for observability only:

- `searchPlanId`
- `generatedTaskCount`
- `insertedTaskCount`

These are not new queue payload fields.

## Worker Integration

`processCampaignPlanJob` keeps its injectable test seam, but its production default changes from a no-op to the real search planner.

The queue payload remains identifier-only:

```text
jobId
workspaceId
campaignId
```

`campaign-plan` continues using M1 retry/backoff/DLQ/expiration/concurrency/idempotency behavior.

No `campaign-discovery` jobs are scheduled in M3. That handoff starts in M4 after a real discovery provider abstraction exists.

## Error Handling

- missing campaign or workspace/campaign mismatch: throw a planner error; pg-boss retry/failure remains visible through `JobMetadata`.
- `DRAFT` campaign received by planner: reject as invalid state.
- `CANCELLED` campaign: successful no-op.
- `PLANNING` or `PAUSED`: plan normally.
- database transaction failure: no partial `SearchPlan`/task batch is accepted by the planner call; queue retry is safe.

## Testing

TDD coverage includes:

- Dentist expands to the exact deterministic seven-query set.
- unknown niches fall back to one trimmed query.
- explicit city/region targets are preserved.
- United States country-only targeting expands to multiple state-level targets.
- campaign target `requestedLeadCount = 10_000` produces multiple persisted `SearchTask` records.
- task defaults are `PENDING` with zero counters.
- workspace/campaign identifier mismatch is rejected.
- cancelled campaigns create no search plan/tasks.
- repeating the planner creates no duplicate tasks.
- a task manually marked `COMPLETED` with counters stays completed with counters unchanged after planner replay.
- a stopped producer's `campaign-plan` job is consumed by an independently started worker and creates persisted search space using the production default planner.
- full repository CI passes: frozen install, Prisma validation/migrations, tests, typecheck, lint, production build, compiled smoke-start.

## Acceptance Criteria

M3 is complete when:

- a 10,000-lead United States Dentist campaign generates many smaller persisted `SearchTask` records.
- every task contains country, region, city, geographicCell, query, provider, status, attemptCount, resultCount, and uniqueBusinessCount.
- deterministic Dentist niche expansion matches the agreed default set.
- geography expansion is behind an abstraction and is not embedded in `CampaignsService`.
- duplicate provider/country/region/city/query search space is database-protected within a campaign plan.
- planner retries/replays reuse the same `SearchPlan` and do not reset existing task state or counters.
- completed search space is not unnecessarily repeated.
- the independent `campaign-plan` worker performs real planning rather than a no-op.
- no real provider/business discovery integration is added before M4.
- all repository CI gates pass on the exact merge candidate SHA.
