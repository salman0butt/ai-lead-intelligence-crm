# Milestone 2 Campaign Management Design

## Goal

Add the first production campaign domain to the CRM: users can create workspace-scoped lead-generation campaigns, view them, control their lifecycle, and start durable planning work through the M1 PostgreSQL queue system.

## Scope

Milestone 2 includes:

- Campaign persistence in PostgreSQL through Prisma.
- Campaign creation, list, detail, start, pause, resume, and cancel APIs.
- Workspace authorization on every campaign read/write.
- Durable `campaign-plan` scheduling through `QueueService`.
- A basic `campaign-plan` worker handoff that records queue execution but performs no discovery yet.
- Next.js campaign list, create, and detail routes using the existing browser API client, session storage, and TanStack Query.

Milestone 2 explicitly does not include Google Business discovery, enrichment, website crawling, AI research, outreach generation, provider integrations, SSE progress streaming, or campaign result tables.

## Data Model

Add `CampaignStatus`:

- `DRAFT`
- `PLANNING`
- `PAUSED`
- `CANCELLED`

Add `Campaign` with:

- `id: UUID`
- `workspaceId: UUID`
- `createdByUserId: UUID`
- `name: varchar(160)`
- `country: varchar(120)`
- `region: varchar(120) nullable`
- `city: varchar(120) nullable`
- `niche: varchar(160)`
- `requestedLeadCount: integer`
- `status: CampaignStatus`, default `DRAFT`
- `createdAt`
- `updatedAt`

Relations:

- Workspace has many campaigns.
- User has many created campaigns.
- Campaign belongs to one workspace and one creator.
- Deleting a workspace cascades campaign deletion.
- Deleting a user is restricted while authored campaigns exist, preserving campaign audit ownership.

Indexes:

- `(workspaceId, createdAt)` for workspace campaign lists.
- `(workspaceId, status)` for lifecycle filtering later.

`requestedLeadCount` is validated as a positive integer. M2 does not impose an arbitrary small product cap.

## Validation Contracts

`createCampaignSchema` accepts:

- `workspaceId`: UUID
- `name`: trimmed string, 1..160
- `country`: trimmed string, 1..120
- `region`: optional trimmed string, 1..120
- `city`: optional trimmed string, 1..120
- `niche`: trimmed string, 1..160
- `requestedLeadCount`: integer >= 1

Empty optional region/city values normalize to `undefined` so PostgreSQL stores them as null.

## API

All endpoints require the existing auth guard.

### POST `/campaigns`

Creates a `DRAFT` campaign after verifying the authenticated user belongs to `workspaceId`.

### GET `/campaigns?workspaceId=<uuid>`

Lists campaigns for one workspace after membership validation, newest first.

### GET `/campaigns/:campaignId`

Loads the campaign and then verifies membership in its workspace. Missing campaign returns 404; inaccessible campaign returns 403.

### POST `/campaigns/:campaignId/start`

Allowed only from `DRAFT`.

Flow:

1. Load campaign and verify workspace membership.
2. In a database transaction, conditionally update `DRAFT -> PLANNING`. If no row changes, reject with 409.
3. Enqueue `campaign-plan` with payload `{ workspaceId, campaignId }` and idempotency key `campaign-plan:<campaignId>`.
4. If enqueue throws before a job is accepted, restore `PLANNING -> DRAFT` only if the campaign is still in `PLANNING`, then rethrow.
5. Return the updated campaign plus the queue result.

The queue payload contains identifiers only.

### POST `/campaigns/:campaignId/pause`

Allowed from `PLANNING`; transitions to `PAUSED`.

### POST `/campaigns/:campaignId/resume`

Allowed from `PAUSED`; transitions to `PLANNING`. Resume does not create a second `campaign-plan` job in M2 because the durable planning handoff already exists and discovery execution is not implemented yet.

### POST `/campaigns/:campaignId/cancel`

Allowed from `DRAFT`, `PLANNING`, or `PAUSED`; transitions to `CANCELLED`. Repeated cancel returns 409 rather than silently mutating a terminal campaign.

## Lifecycle Rules

Lifecycle transitions are centralized in `CampaignsService` and use conditional database updates (`updateMany` with current status predicates) so concurrent requests cannot both win a state transition.

Valid transitions:

- `DRAFT -> PLANNING`
- `PLANNING -> PAUSED`
- `PAUSED -> PLANNING`
- `DRAFT | PLANNING | PAUSED -> CANCELLED`

Invalid or stale transitions return HTTP 409 Conflict.

## Queue / Worker

The existing M1 queue catalog already contains `campaign-plan`; M2 reuses it without adding another broker.

The worker registers a `campaign-plan` processor. For M2 it is intentionally a no-op domain handler wrapped by the same tracked-job execution mechanism used by `system-test`, proving independent worker pickup and JobMetadata status transitions without performing discovery.

Queue metadata, retry/backoff, DLQ, expiration, priority support, concurrency, and idempotency remain owned by `packages/queue` from M1.

## Frontend

Add routes:

- `/campaigns`
- `/campaigns/new`
- `/campaigns/[id]`

The pages reuse the existing session token and selected workspace storage.

### Campaign list

- Requires a stored session token.
- Requires a selected workspace.
- Fetches `/campaigns?workspaceId=...` with TanStack Query.
- Shows campaign name, niche, geography, requested lead count, and status.
- Links to detail and create pages.

### Create campaign

- Uses the selected workspace.
- Captures name, country, optional region/city, niche, and requested lead count.
- Creates via `POST /campaigns` and navigates to the campaign detail page.

### Campaign detail

- Fetches `/campaigns/:id`.
- Displays campaign targeting and status.
- Shows lifecycle buttons only when valid for the current status.
- Mutations invalidate both campaign detail and campaign list queries.

The dashboard gains a Campaigns navigation action and no longer claims campaigns are a future milestone.

## Error Handling

- 400: malformed request/query values.
- 401: existing authentication guard.
- 403: authenticated user is not a workspace member.
- 404: campaign does not exist.
- 409: invalid or concurrently stale lifecycle transition.
- Queue enqueue errors are surfaced; start attempts roll the campaign back to `DRAFT` when safe.

## Testing

TDD coverage includes:

- Zod campaign validation.
- Prisma campaign defaults and relationships.
- Workspace tenant isolation.
- Create/list/detail service behavior.
- Valid and invalid lifecycle transitions.
- Start queue payload and idempotency key.
- Start rollback on queue publication failure.
- `campaign-plan` worker registration and tracked completion.
- API controller routing/auth wiring through compile/build coverage.
- Frontend helper/component behavior where logic is non-trivial.
- Full CI: frozen install, Prisma validation/migrations, tests, typecheck, lint, build, compiled smoke.

## Acceptance Criteria

M2 is complete when:

- A workspace member can create a campaign with no arbitrary small requested-lead limit.
- Campaigns are isolated by workspace membership.
- List/detail routes return persisted campaigns.
- Start transitions `DRAFT -> PLANNING` and schedules exactly one idempotent `campaign-plan` job.
- Invalid/concurrent lifecycle transitions are rejected.
- Pause, resume, and cancel transitions work as defined.
- An independent worker can consume `campaign-plan` and update job metadata through the M1 tracked-job mechanism.
- `/campaigns`, `/campaigns/new`, and `/campaigns/[id]` build successfully and use the existing auth/workspace session model.
- All repository CI gates pass on the exact merge candidate SHA.
