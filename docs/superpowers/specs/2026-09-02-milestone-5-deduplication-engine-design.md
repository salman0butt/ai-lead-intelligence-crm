# Milestone 5 Deduplication Engine Design

## Goal

Turn raw, campaign-scoped `BusinessCandidate` records from Milestone 4 into unique, workspace-scoped canonical `Business` records while preserving candidate provenance and avoiding false-positive merges.

M5 introduces deterministic layered matching only. It must not use AI, embeddings, external APIs, browser navigation, website crawling, or another queue.

## Roadmap contract

The recovered roadmap requires M5 to:

- canonicalize raw `BusinessCandidate` rows into `Business` rows;
- deduplicate across campaigns inside the same workspace;
- use provider external identity, canonical domain, and phone as strong signals;
- use normalized business identity fields such as name, address, city, and postal code as deterministic secondary signals;
- use cautious fuzzy matching only after stronger rules fail;
- persist `matchedBusinessId`, `duplicateConfidence`, and `duplicateReason` on candidates;
- preserve M4 candidate uniqueness and provenance semantics;
- leave official-domain discovery/verification to M6.

M4 already persists candidates in the discovery worker transaction. M5 extends that persistence path instead of introducing a separate asynchronous pipeline.

## Milestone boundary

M5 includes:

- canonical `Business` persistence;
- candidate identity input fields needed by the matching engine;
- normalization utilities;
- deterministic strong and secondary exact matching;
- cautious deterministic fuzzy matching;
- candidate-to-canonical linkage and audit metadata;
- replay-safe canonicalization;
- concurrency protection for canonical creation;
- an idempotent backfill path for candidates that existed before the M5 migration;
- unit and integration verification of the full M4 -> M5 persistence path.

M5 explicitly excludes:

- discovering or verifying an official website/domain (M6);
- visiting websites or crawling pages (M6/M7);
- contact/email enrichment (M8);
- website technology or audit analysis (M9);
- OpenAI/LangGraph research (M10+);
- lead scoring (M15);
- results/filter UI (M16);
- CRM and outreach workflows (M17+).

`phone`, `canonicalDomain`, `city`, and `postalCode` are identity input slots in M5. They may be null for current M4 browser candidates. Later milestones may populate them, but M5 does not discover them.

## Chosen approach

Use deterministic layered matching in TypeScript.

The matching order is:

```text
BusinessCandidate
        |
        v
normalize identity fields
        |
        v
strong exact rules
        |
        v
secondary exact rules
        |
        v
cautious fuzzy fallback
        |
        v
existing Business OR new Business
        |
        v
persist matchedBusinessId + confidence + reason
```

Rejected alternatives:

1. **Database uniqueness only** — insufficient for normalized spelling/address variation and does not satisfy the roadmap's fuzzy fallback requirement.
2. **AI/embedding deduplication** — rejected because it adds cost, latency, non-determinism, and an unnecessary dependency on later AI infrastructure milestones.

## Package boundaries

Keep the matching primitives in the existing provider-neutral discovery package, without Prisma or pg-boss dependencies:

```text
packages/discovery/src/deduplication/
  types.ts
  normalize.ts
  similarity.ts
  match.ts
```

Responsibilities:

- `normalize.ts` owns conservative identity normalization.
- `similarity.ts` owns deterministic string/token similarity.
- `match.ts` owns fuzzy score calculation, thresholds, confidence constants, and rule result types.
- the package performs no database reads or writes.

Persistence orchestration belongs in the worker/application layer because it depends on Prisma:

```text
apps/worker/src/deduplication/
  business-canonicalizer.ts
  canonicalization-backfill.ts
```

`business-canonicalizer.ts` queries existing workspace businesses/candidates in matching order, applies pure matching primitives, creates or reuses the canonical business, and updates the candidate inside the caller's transaction.

The M4 provider adapters remain unaware of canonical persistence.

## Data model

### Canonical Business

Add a workspace-scoped `Business` model:

```text
Business
  id
  workspaceId

  name
  normalizedName

  formattedAddress
  normalizedAddress

  city nullable
  normalizedCity nullable
  postalCode nullable
  normalizedPostalCode nullable

  phone nullable
  normalizedPhone nullable

  canonicalDomain nullable

  createdAt
  updatedAt
```

Relationships:

- `Workspace.businesses -> Business[]`.
- `Business.candidates -> BusinessCandidate[]` through `matchedBusinessId`.

A `Business` belongs to a workspace, not a campaign. The same real business discovered by two campaigns in one workspace must map to one canonical row.

M5 does not make canonical domain, phone, name/address, or name/city/postal database-unique. Those values are strong matching signals, not unconditional relational uniqueness guarantees. Canonicalization concurrency is handled explicitly in the transaction flow described below.

Recommended indexes:

```text
workspaceId + canonicalDomain
workspaceId + normalizedPhone
workspaceId + normalizedName + normalizedAddress
workspaceId + normalizedName + normalizedCity + normalizedPostalCode
workspaceId + normalizedCity
workspaceId + normalizedPostalCode
```

### BusinessCandidate additions

Extend `BusinessCandidate` with:

```text
matchedBusinessId nullable during migration/backfill
duplicateConfidence nullable during migration/backfill
duplicateReason nullable during migration/backfill

city nullable
postalCode nullable
phone nullable
canonicalDomain nullable
```

Add indexes for:

```text
workspaceId + provider + providerExternalId
matchedBusinessId
```

The existing M4 uniqueness remains unchanged:

```text
campaignId + provider + providerExternalId
```

That constraint continues to prevent repeated exact provider candidates inside one campaign. M5 adds a workspace-level canonical layer above it.

### Duplicate reason

Persist stable machine-readable reasons using a Prisma enum or an equivalent constrained representation:

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

These values are intended for later debugging, evaluation, filtering, and audit UI and must not be replaced with free-form prose.

### Confidence semantics

`duplicateConfidence` means confidence that the incoming candidate represents an already-existing canonical business.

Exact rule constants are:

```text
PROVIDER_EXTERNAL_ID       1.00
CANONICAL_DOMAIN           0.99
PHONE                      0.99
NAME_ADDRESS_EXACT         0.98
NAME_CITY_POSTAL_EXACT     0.97
```

For fuzzy decisions, persist the calculated deterministic score.

For `NEW_CANONICAL`, persist `0.00`.

For `FUZZY_LOW_CONFIDENCE_NOT_MERGED`, persist the best rejected fuzzy score. `matchedBusinessId` points to the newly created canonical business, not to the rejected possible duplicate.

The schema fields remain nullable only so the migration can be applied safely before pre-M5 rows are backfilled. New M5 discovery persistence must leave the transaction with all three canonicalization fields populated.

## Normalization

Normalization must be conservative. M5 should reduce presentation differences without inventing equivalence.

### General text

For names, cities, addresses, and postal values where applicable:

1. trim leading/trailing whitespace;
2. Unicode-normalize using NFKC;
3. lowercase using deterministic locale-independent casing;
4. replace punctuation/separator runs with spaces where safe;
5. collapse repeated whitespace;
6. trim again.

Do not aggressively remove legal/entity/category words such as:

```text
LLC
Ltd
Limited
Clinic
Dental
Group
Services
```

Those tokens can distinguish real businesses.

Do not automatically expand or collapse address abbreviations such as `St`/`Street`, `Rd`/`Road`, or unit/suite labels in M5. Aggressive address semantics can create false merges and belong in a separately evaluated enhancement if needed.

### Postal code

Normalize by Unicode normalization, lowercase, trimming, and removing presentation-only whitespace/punctuation. Do not infer missing country-specific components.

### Phone

Phone normalization is deterministic and non-inferential:

- trim whitespace;
- retain an explicit leading `+` when present;
- remove formatting punctuation/spaces;
- retain digits only otherwise.

M5 must not guess a country code for local numbers and must not call a phone-validation service.

### Canonical domain

If a domain input is present:

- accept a hostname or URL-like value;
- parse through the platform URL implementation;
- lowercase the hostname;
- convert to the canonical ASCII hostname representation supplied by the URL parser;
- remove a trailing dot;
- remove a leading `www.`;
- ignore scheme, path, query, fragment, and port;
- reject empty or unparseable hosts rather than inventing a value.

M5 does not verify ownership or whether the domain is official. M6 owns that work.

## Matching order

Canonicalization is always workspace-scoped and runs in the following order.

### 1. Existing candidate association

If `BusinessCandidate.matchedBusinessId` is already populated, return that association immediately.

This is the replay/idempotency fast path. Replaying the same persisted candidate must not create or rematch another `Business`.

### 2. Provider external identity

Search prior workspace candidates for:

```text
workspaceId
provider
providerExternalId
matchedBusinessId != null
```

A match returns the already-linked canonical business with:

```text
confidence = 1.00
reason = PROVIDER_EXTERNAL_ID
```

This is what deduplicates the same provider listing discovered by multiple campaigns.

The provider name is part of the key. External IDs from different providers are never compared as equal merely because the raw ID strings match.

### 3. Canonical domain exact

If the incoming candidate has a normalized canonical domain, find an existing workspace `Business` with the same `canonicalDomain`.

Return:

```text
confidence = 0.99
reason = CANONICAL_DOMAIN
```

M5 only consumes this input; it does not discover it.

### 4. Normalized phone exact

If the incoming candidate has a normalized phone, find an existing workspace `Business` with the same `normalizedPhone`.

Return:

```text
confidence = 0.99
reason = PHONE
```

### 5. Normalized name + normalized address exact

If both values are non-empty, match:

```text
workspaceId
normalizedName
normalizedAddress
```

Return:

```text
confidence = 0.98
reason = NAME_ADDRESS_EXACT
```

### 6. Normalized name + city + postal exact

When all required values are present, match:

```text
workspaceId
normalizedName
normalizedCity
normalizedPostalCode
```

Return:

```text
confidence = 0.97
reason = NAME_CITY_POSTAL_EXACT
```

### Strong-identifier conflict veto for weaker rules

Before accepting a secondary exact or fuzzy match, reject that candidate business from weaker-rule consideration when both sides contain a non-null strong identifier and the normalized values conflict.

Examples:

```text
candidate canonicalDomain != existing canonicalDomain
candidate normalizedPhone  != existing normalizedPhone
```

This veto does not override an earlier provider-external-ID/domain/phone strong match. It prevents a weaker name/address similarity from merging two records when stronger available evidence explicitly disagrees.

## Fuzzy fallback

Fuzzy matching runs only when all strong and secondary exact rules fail.

It is deterministic and deliberately conservative.

### Candidate pool

Do not scan every business in the workspace by default.

A fuzzy pool is eligible only when the incoming candidate has supporting geography:

1. if `normalizedPostalCode` is present, compare workspace businesses with that postal code;
2. otherwise, if `normalizedCity` is present, compare workspace businesses with that city;
3. otherwise skip fuzzy auto-merge and create a new canonical business.

This keeps fuzzy comparison bounded and prevents unsupported same-name merges when M4 has not supplied city/postal identity fields.

The strong-identifier conflict veto is applied to every fuzzy pool member before scoring.

### Similarity functions

Use deterministic local functions only.

For each normalized string, calculate:

- normalized Levenshtein/edit similarity in `[0, 1]`;
- token Jaccard similarity in `[0, 1]`.

Suggested component scores:

```text
nameSimilarity    = 0.70 * editSimilarity + 0.30 * tokenJaccard
addressSimilarity = 0.40 * editSimilarity + 0.60 * tokenJaccard
```

Overall fuzzy score:

```text
score = 0.60 * nameSimilarity + 0.40 * addressSimilarity
```

All constants are source-controlled and unit-tested. No randomness, model calls, embeddings, or remote services are allowed.

### Auto-merge threshold

Auto-merge only when all conditions hold:

```text
score >= 0.93
nameSimilarity >= 0.90
addressSimilarity >= 0.88
supporting city or postal match exists
```

If multiple eligible existing businesses score above the auto-merge threshold, the best score must exceed the second-best score by at least `0.03`.

If that ambiguity margin is not met, do not auto-merge.

A successful fuzzy merge records:

```text
reason = FUZZY_HIGH_CONFIDENCE
confidence = calculated score
```

### Low-confidence fuzzy behavior

If an eligible fuzzy pool exists and the best score is at least `0.80` but fails any auto-merge condition, create a new `Business` and record:

```text
reason = FUZZY_LOW_CONFIDENCE_NOT_MERGED
confidence = best rejected score
```

This reason also covers ambiguity-margin rejection.

If the best score is below `0.80`, or no eligible fuzzy pool exists, create a new `Business` with:

```text
reason = NEW_CANONICAL
confidence = 0.00
```

M5 does not persist a separate pointer to the rejected fuzzy alternative. A future human-review/suggestion feature can add a dedicated relation if the product needs one; M5 avoids adding that unused schema now.

## Creating a canonical Business

When no existing business is accepted, create one from the incoming candidate.

Populate:

```text
name                <- candidate.name
normalizedName      <- normalized candidate name
formattedAddress    <- candidate.formattedAddress
normalizedAddress   <- normalized candidate address
city                <- candidate.city
normalizedCity      <- normalized candidate city
postalCode          <- candidate.postalCode
normalizedPostalCode<- normalized candidate postal
phone               <- candidate.phone
normalizedPhone     <- normalized candidate phone
canonicalDomain     <- normalized candidate canonicalDomain
```

M5 uses first-canonicalized values as the canonical display identity. When another candidate later links to the same business, M5 may fill a currently-null optional canonical identifier from the new candidate, but it must not overwrite a different non-null phone/domain merely because a weaker rule matched.

M5 does not implement source-ranking or field-level provenance merging. Those concerns can be added when later enrichment milestones introduce richer data quality evidence.

## Persistence flow

Extend the current M4 discovery transaction.

Today the worker does:

```text
browser/provider result
  -> BusinessCandidate upsert
  -> BusinessSource createMany
  -> SearchTask counters/cursor update
  -> ProviderUsage update
```

M5 becomes:

```text
browser/provider result
  -> BusinessCandidate upsert
  -> canonicalize candidate
       -> existing Business match? link it
       -> otherwise create Business and link it
  -> BusinessSource createMany
  -> SearchTask counters/cursor update
  -> ProviderUsage update
```

Canonicalization runs inside the same database transaction as candidate/provenance persistence.

If canonicalization throws, the page persistence transaction rolls back. The existing M4 error path then marks the discovery task failed and allows pg-boss retry/backoff behavior. M5 must not leave a newly persisted candidate partially canonicalized from a successful page transaction.

No new queue, job type, provider request, or usage-accounting event is created for M5.

## Concurrency correctness

Idempotent candidate replay alone does not prevent this race:

```text
worker A: no Business found
worker B: no Business found
worker A: create Business X
worker B: create Business Y
```

Multiple worker processes or higher discovery concurrency can therefore create duplicate canonical rows unless M5 serializes the match/create decision.

Acquire one PostgreSQL transaction-scoped advisory lock keyed by `workspaceId` before canonicalizing candidates in the page persistence transaction.

Properties:

- the lock exists only for the current transaction;
- different workspaces remain independent;
- all matching queries and canonical creation for one workspace observe a serialized order;
- a hash collision may over-serialize unrelated workspaces but cannot create incorrect merges;
- no Redis/distributed-lock service is introduced.

Because the existing M4 page transaction already processes candidate results sequentially, acquire the workspace lock once per page transaction rather than once per candidate.

The backfill path uses the same workspace locking rule.

This is intentionally conservative for M5. Performance/scale optimization of canonicalization belongs to later scale validation only if measurement shows this workspace-level critical section is a bottleneck.

## Replay and idempotency

Required invariants:

1. a candidate with `matchedBusinessId` never creates another canonical business on replay;
2. the same provider/external ID across campaigns in one workspace resolves to the same business;
3. `BusinessSource` provenance uniqueness remains unchanged;
4. replaying the same discovery page does not create another canonical business;
5. canonicalization never links across workspaces;
6. a failed transaction leaves no partial M5 candidate/business association.

## Existing-candidate backfill

The migration must be deployable on a database that already contains M4 candidates.

Therefore M5 adds nullable canonicalization columns first and ships an idempotent backfill command that:

1. scans workspaces in stable order;
2. acquires the same transaction-scoped workspace lock;
3. scans unmatched candidates in stable `createdAt, id` order;
4. runs the same `business-canonicalizer` used by live discovery;
5. commits in bounded batches/transactions so a large dataset does not require one global transaction;
6. can be safely re-run because already matched candidates short-circuit.

The backfill is a local/database command, not a pg-boss job and not another queue.

Current M4 candidates may have null city/postal/phone/domain, so their backfill naturally relies on provider identity and normalized name/address rules. Fuzzy auto-merge is skipped when supporting geography is unavailable.

## Error handling

M5 introduces no recoverable external dependency, so errors are application/database failures rather than provider failures.

Rules:

- normalization must fail closed on invalid optional domain input by treating the normalized domain as null rather than throwing the discovery page away;
- invalid required identity values such as an empty normalized name or address do not trigger fuzzy/secondary rules, but the candidate can still canonicalize through provider identity or become a new canonical business;
- database errors roll back the current transaction;
- canonicalization errors do not increment `ProviderUsage.errorCount`, because deduplication is not a provider request;
- no error path may delete M4 `BusinessSource` provenance from previously successful transactions.

## Testing strategy

Follow TDD for implementation.

### Pure unit tests

Normalization:

- Unicode NFKC normalization;
- case, punctuation, and whitespace normalization;
- no aggressive removal of legal/category words;
- deterministic phone formatting removal;
- no inferred phone country code;
- canonical domain normalization;
- invalid domain -> null;
- postal normalization.

Similarity/matching primitives:

- deterministic edit similarity;
- deterministic token Jaccard;
- high-confidence fuzzy score;
- low-confidence threshold behavior;
- ambiguity margin behavior;
- strong-identifier conflict veto.

### Database/integration tests

Required cases:

- same provider business found by multiple campaigns -> one canonical `Business`;
- workspace isolation -> identical provider identity in different workspaces does not share a business;
- canonical-domain exact match;
- normalized-phone exact match;
- normalized name/address exact match;
- normalized name/city/postal exact match;
- punctuation/case/whitespace normalization;
- high-confidence supported fuzzy match merges;
- fuzzy matching without supporting geography does not auto-merge;
- low-confidence fuzzy candidate creates its own business;
- ambiguous high fuzzy candidates do not auto-merge;
- two similar but distinct businesses remain separate;
- conflicting strong identifiers veto weaker merge;
- candidate replay remains idempotent;
- multiple candidates reference one canonical business;
- concurrent equivalent candidates cannot create two canonical businesses;
- M4 discovery persistence automatically canonicalizes candidates;
- transaction rollback does not leave a partial candidate/business link;
- pre-M5 candidates are canonicalized by the idempotent backfill;
- running the backfill twice does not create additional businesses;
- no network/API/AI calls are reachable from deduplication tests.

### Regression verification

Run the existing repository gates after M5 implementation:

```text
lint
typecheck
unit/integration tests
Prisma schema validation/migrations
build
existing browser discovery regression tests
existing CI workflow
```

M5 must preserve the M4 browser discovery behavior and provenance/cursor semantics.

## Acceptance criteria

M5 is complete when:

- every newly persisted M4 candidate is linked to a workspace-scoped canonical `Business` in the same successful transaction;
- the same provider listing found in different campaigns maps to one canonical business;
- exact domain, phone, name/address, and name/city/postal matching follow the defined confidence/reason rules;
- fuzzy matching is deterministic, bounded, geography-supported, ambiguity-aware, and conservative;
- low-confidence fuzzy comparisons do not auto-merge;
- canonicalization is workspace-isolated and concurrency-safe;
- replay/backfill are idempotent;
- candidate provenance remains intact;
- M5 performs no provider/browser/API/AI/network work;
- all M5 and existing regression tests pass;
- milestone verification is recorded before merging M5 to `main`.

## Deferred work

M6 and later remain responsible for:

- discovering and verifying official domains;
- browsing/crawling websites;
- collecting contact information;
- enriching canonical business fields with source-quality policies;
- AI research and opportunity detection;
- lead scoring;
- user-facing duplicate review/merge tooling;
- CRM and outreach workflows;
- performance-specific canonicalization redesign if later scale measurements justify it.
