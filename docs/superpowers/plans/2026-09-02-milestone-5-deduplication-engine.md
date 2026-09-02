# Milestone 5 Deduplication Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canonicalize every persisted `BusinessCandidate` into a workspace-scoped `Business` using deterministic layered deduplication, conservative fuzzy matching, transactional concurrency safety, and an idempotent backfill path.

**Architecture:** Add pure normalization/similarity/matching primitives under `packages/discovery/src/deduplication`, then add Prisma-backed canonicalization orchestration in the worker. Extend the existing M4 discovery transaction so candidate upsert, canonical linkage, provenance, cursor/counters, and usage persistence stay atomic. Serialize match/create decisions per workspace with a PostgreSQL transaction-scoped advisory lock and do not add another queue, network dependency, AI call, or provider request.

**Tech Stack:** TypeScript 6, Node.js 24+, PostgreSQL 17, Prisma, pg-boss 12.28.0, Vitest, Playwright 1.62.1 regression coverage, pnpm 11.24.0.

**Spec:** `docs/superpowers/specs/2026-09-02-milestone-5-deduplication-engine-design.md`

## Global Constraints

- `Business` is workspace-scoped, never campaign-scoped.
- Preserve M4 `BusinessCandidate` uniqueness on `(campaignId, provider, providerExternalId)`.
- No Redis, BullMQ, RabbitMQ, Kafka, Temporal, new queue, AI, embeddings, browser navigation, website requests, or external APIs for M5.
- Matching order is existing association -> provider external ID -> canonical domain -> normalized phone -> normalized name/address -> normalized name/city/postal -> cautious fuzzy fallback.
- Strong-identifier conflicts veto secondary/fuzzy merges.
- Exact lookups with more than one eligible canonical row are ambiguous and must not select by incidental database order.
- Fuzzy auto-merge requires score `>= 0.93`, name similarity `>= 0.90`, address similarity `>= 0.88`, geography support, and a `>= 0.03` lead over the second-best eligible candidate.
- Fuzzy scores use the exact weights from the spec; no random or model-based behavior.
- Low-confidence/ambiguous fuzzy comparisons do not merge.
- New M5 discovery transactions must populate `matchedBusinessId`, `duplicateConfidence`, and `duplicateReason` before commit.
- Canonical match/create is serialized per workspace with a PostgreSQL transaction-scoped advisory lock.
- Existing M4 rows are handled through an idempotent local/database backfill, not pg-boss.
- Every implementation task follows RED -> minimal implementation -> GREEN -> commit.

---

### Task 1: Add canonical-business persistence schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260902150000_milestone_5_deduplication/migration.sql`
- Modify: `packages/database/src/index.ts` only if generated enum/model exports require an explicit barrel change
- Test: `apps/worker/test/business-deduplication.integration.test.ts`

**Interfaces:**
- Produces Prisma enum `DuplicateReason` with `PROVIDER_EXTERNAL_ID`, `CANONICAL_DOMAIN`, `PHONE`, `NAME_ADDRESS_EXACT`, `NAME_CITY_POSTAL_EXACT`, `FUZZY_HIGH_CONFIDENCE`, `FUZZY_LOW_CONFIDENCE_NOT_MERGED`, `NEW_CANONICAL`.
- Produces model `Business` with workspace relation and normalized identity columns from the spec.
- Extends `BusinessCandidate` with nullable `matchedBusinessId`, `duplicateConfidence`, `duplicateReason`, `city`, `postalCode`, `phone`, and `canonicalDomain`.

- [ ] **Step 1: write the failing schema/integration assertion**

Create a database-backed test that creates a workspace/campaign/candidate and expects Prisma to accept canonical fields:

```ts
const business = await database.business.create({
  data: {
    workspaceId,
    name: 'Acme Dental',
    normalizedName: 'acme dental',
    formattedAddress: '12 Main St',
    normalizedAddress: '12 main st',
  },
});

await database.businessCandidate.update({
  where: { id: candidate.id },
  data: {
    matchedBusinessId: business.id,
    duplicateConfidence: 0,
    duplicateReason: DuplicateReason.NEW_CANONICAL,
  },
});
```

- [ ] **Step 2: run the focused test and verify RED**

Run:

```bash
pnpm db:generate
pnpm --filter @ai-crm/worker test -- business-deduplication.integration.test.ts
```

Expected: generated Prisma client has no `business` model / M5 candidate fields.

- [ ] **Step 3: add the Prisma model, enum, relations, and required indexes**

Use nullable M5 candidate association fields for migration/backfill safety. Add indexes:

```text
Business(workspaceId, canonicalDomain)
Business(workspaceId, normalizedPhone)
Business(workspaceId, normalizedName, normalizedAddress)
Business(workspaceId, normalizedName, normalizedCity, normalizedPostalCode)
Business(workspaceId, normalizedCity)
Business(workspaceId, normalizedPostalCode)
BusinessCandidate(workspaceId, provider, providerExternalId)
BusinessCandidate(matchedBusinessId)
```

- [ ] **Step 4: write the migration SQL and validate it on PostgreSQL**

Run:

```bash
pnpm db:validate
pnpm db:up
pnpm db:deploy
pnpm db:generate
```

Expected: migration applies from the current M4 schema without destructive changes to candidate/source rows.

- [ ] **Step 5: rerun the focused test and verify GREEN**

- [ ] **Step 6: commit**

```bash
git add packages/database apps/worker/test/business-deduplication.integration.test.ts
git commit -m "feat: add canonical business schema"
```

---

### Task 2: Implement conservative identity normalization

**Files:**
- Create: `packages/discovery/src/deduplication/types.ts`
- Create: `packages/discovery/src/deduplication/normalize.ts`
- Create: `packages/discovery/test/deduplication-normalize.test.ts`
- Modify: `packages/discovery/src/index.ts`

**Interfaces:**

```ts
export interface NormalizedBusinessIdentity {
  normalizedName: string;
  normalizedAddress: string;
  normalizedCity: string | null;
  normalizedPostalCode: string | null;
  normalizedPhone: string | null;
  canonicalDomain: string | null;
}

export function normalizeIdentity(input: {
  name: string;
  formattedAddress: string;
  city?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  canonicalDomain?: string | null;
}): NormalizedBusinessIdentity;

export function normalizeText(value: string): string;
export function normalizePostalCode(value: string | null | undefined): string | null;
export function normalizePhone(value: string | null | undefined): string | null;
export function normalizeDomain(value: string | null | undefined): string | null;
```

- [ ] **Step 1: write failing normalization tests**

Include assertions for NFKC, lowercase, punctuation/whitespace collapse, preservation of `LLC`/`Ltd`/`Clinic` words after lowercasing, no `St` -> `Street` expansion, phone formatting removal without inferred country code, postal presentation cleanup, `www.` removal, path/query removal, IDNA/URL-parser hostname handling, and invalid domain -> `null`.

Example:

```ts
expect(normalizeText('  ACME,   Dental LLC ')).toBe('acme dental llc');
expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
expect(normalizeDomain('https://WWW.Example.com/path?q=1')).toBe('example.com');
expect(normalizeDomain('://bad host')).toBeNull();
```

- [ ] **Step 2: run and verify RED**

```bash
pnpm --filter @ai-crm/discovery test -- deduplication-normalize.test.ts
```

- [ ] **Step 3: implement minimal deterministic normalization**

Use `String.prototype.normalize('NFKC')`, locale-independent lowercase, Unicode letter/number-aware separator cleanup, and the platform `URL` parser. Do not infer missing values.

- [ ] **Step 4: rerun focused tests and verify GREEN**

- [ ] **Step 5: run discovery package typecheck**

```bash
pnpm --filter @ai-crm/discovery typecheck
```

- [ ] **Step 6: commit**

```bash
git add packages/discovery
git commit -m "feat: normalize business identity fields"
```

---

### Task 3: Implement deterministic similarity and fuzzy decision rules

**Files:**
- Create: `packages/discovery/src/deduplication/similarity.ts`
- Create: `packages/discovery/src/deduplication/match.ts`
- Create: `packages/discovery/test/deduplication-match.test.ts`
- Modify: `packages/discovery/src/index.ts`

**Interfaces:**

```ts
export function editSimilarity(left: string, right: string): number;
export function tokenJaccard(left: string, right: string): number;

export interface FuzzyComparableIdentity {
  normalizedName: string;
  normalizedAddress: string;
  normalizedCity: string | null;
  normalizedPostalCode: string | null;
  normalizedPhone: string | null;
  canonicalDomain: string | null;
}

export interface FuzzyScore {
  nameSimilarity: number;
  addressSimilarity: number;
  score: number;
}

export function scoreFuzzyMatch(incoming: FuzzyComparableIdentity, existing: FuzzyComparableIdentity): FuzzyScore;
export function hasStrongIdentifierConflict(incoming: FuzzyComparableIdentity, existing: FuzzyComparableIdentity): boolean;
export function canAutoMergeFuzzy(best: FuzzyScore, secondBestScore: number | null, hasGeographySupport: boolean): boolean;
```

Required formulas:

```text
nameSimilarity    = 0.70 * editSimilarity + 0.30 * tokenJaccard
addressSimilarity = 0.40 * editSimilarity + 0.60 * tokenJaccard
score             = 0.60 * nameSimilarity + 0.40 * addressSimilarity
```

- [ ] **Step 1: write failing unit tests for edit/Jaccard scoring**

Assert identity strings score `1`, empty/non-empty mismatch scores `0`, token sets are deterministic, and representative small spelling/address changes remain bounded in `[0, 1]`.

- [ ] **Step 2: write failing threshold/ambiguity/conflict tests**

Test:

```ts
expect(hasStrongIdentifierConflict(
  { ...incoming, canonicalDomain: 'a.example' },
  { ...existing, canonicalDomain: 'b.example' },
)).toBe(true);
```

Cover `0.93`, `0.90`, `0.88`, and `0.03` boundaries exactly.

- [ ] **Step 3: run focused tests and verify RED**

```bash
pnpm --filter @ai-crm/discovery test -- deduplication-match.test.ts
```

- [ ] **Step 4: implement the minimal pure functions**

Use an iterative two-row Levenshtein dynamic-programming implementation to avoid an unnecessary dependency. Round only when persisting/displaying if needed; rule comparisons use the raw deterministic floating-point result.

- [ ] **Step 5: run focused tests and discovery typecheck; verify GREEN**

- [ ] **Step 6: commit**

```bash
git add packages/discovery
git commit -m "feat: add deterministic deduplication scoring"
```

---

### Task 4: Implement Prisma-backed canonicalizer and workspace lock

**Files:**
- Create: `apps/worker/src/deduplication/workspace-lock.ts`
- Create: `apps/worker/src/deduplication/business-canonicalizer.ts`
- Create: `apps/worker/test/business-canonicalizer.integration.test.ts`

**Interfaces:**

```ts
export async function acquireWorkspaceCanonicalizationLock(
  tx: DatabaseTransactionClient,
  workspaceId: string,
): Promise<void>;

export async function canonicalizeBusinessCandidate(
  tx: DatabaseTransactionClient,
  candidateId: string,
): Promise<{
  businessId: string;
  confidence: number;
  reason: DuplicateReason;
}>;
```

The lock implementation must execute a PostgreSQL transaction-scoped advisory lock using a deterministic hash of the full workspace UUID. The canonicalizer assumes the caller already acquired the workspace lock for the transaction.

- [ ] **Step 1: write failing provider-ID and replay tests**

Create two campaigns in one workspace with candidates sharing `(provider, providerExternalId)`. Canonicalize the first and then the second; assert one `Business`, two candidates, same `matchedBusinessId`, second reason `PROVIDER_EXTERNAL_ID`, confidence `1`.

Replay the second candidate and assert business count remains `1`.

- [ ] **Step 2: write failing exact-rule tests**

Cover domain, phone, name/address, and name/city/postal matches with exact reason/confidence values. Add workspace-isolation coverage.

- [ ] **Step 3: write failing ambiguity and conflict-veto tests**

Seed two businesses that satisfy the same weaker exact rule and assert the canonicalizer creates a new business instead of selecting one arbitrarily. Seed conflicting non-null domain/phone evidence and assert name/address does not merge.

- [ ] **Step 4: write failing fuzzy tests**

Cover high-confidence supported merge, no-geography non-merge, low-confidence non-merge, second-best ambiguity margin non-merge, and similar-but-distinct businesses.

- [ ] **Step 5: run focused integration tests and verify RED**

```bash
pnpm --filter @ai-crm/worker test -- business-canonicalizer.integration.test.ts
```

- [ ] **Step 6: implement ordered matching and canonical creation**

Required query behavior:

1. return existing candidate association immediately;
2. provider-ID lookup through prior linked candidates in the same workspace;
3. exact `Business` lookups for domain, phone, name/address, name/city/postal;
4. apply exact ambiguity handling;
5. build fuzzy pool by postal, otherwise city, otherwise skip fuzzy;
6. apply strong conflict veto before weaker acceptance;
7. choose best/second-best deterministic scores;
8. create a new canonical business for unresolved/low-confidence cases;
9. update candidate association/reason/confidence;
10. fill only null optional canonical phone/domain values when a newly linked candidate supplies them.

- [ ] **Step 7: implement and verify workspace advisory locking**

Run two concurrent transactions attempting equivalent candidate canonicalization in the same workspace. Assert the committed result contains one canonical `Business`. Also assert different workspaces are not cross-linked.

- [ ] **Step 8: run focused tests and verify GREEN**

- [ ] **Step 9: commit**

```bash
git add apps/worker/src/deduplication apps/worker/test/business-canonicalizer.integration.test.ts
git commit -m "feat: canonicalize duplicate businesses"
```

---

### Task 5: Wire canonicalization into M4 discovery persistence atomically

**Files:**
- Modify: `apps/worker/src/business-discovery.processor.ts`
- Modify: `apps/worker/test/business-discovery-persistence.integration.test.ts`
- Modify: `apps/worker/test/business-discovery.integration.test.ts` only where fixture expectations need the new canonical relation

**Interfaces:**
- Consumes `acquireWorkspaceCanonicalizationLock(tx, workspaceId)` and `canonicalizeBusinessCandidate(tx, candidate.id)`.
- Produces no new queue/job/provider interface.

- [ ] **Step 1: extend the persistence integration test and verify RED**

After one discovery page persists candidates, assert:

```ts
const candidates = await database.businessCandidate.findMany({
  where: { campaignId },
});
expect(candidates.every((candidate) => candidate.matchedBusinessId !== null)).toBe(true);
expect(candidates.every((candidate) => candidate.duplicateReason !== null)).toBe(true);
expect(await database.business.count({ where: { workspaceId } })).toBe(candidates.length);
```

Then execute an equivalent listing in another campaign and assert both candidate rows reference one canonical `Business`.

- [ ] **Step 2: add a rollback test**

Force canonicalization to throw inside the page transaction and assert the page candidate/source/counter updates do not commit. Assert `ProviderUsage.errorCount` is not incremented for the local deduplication failure.

- [ ] **Step 3: run focused tests and verify RED**

- [ ] **Step 4: acquire one workspace lock per page transaction and canonicalize after each candidate upsert**

The transaction order is:

```text
acquire workspace advisory lock once
for each normalized result:
  upsert BusinessCandidate
  canonicalize candidate
  create BusinessSource if new provenance
update SearchTask state/counters
update ProviderUsage resultCount
```

- [ ] **Step 5: rerun M4 discovery persistence/integration tests and verify GREEN**

- [ ] **Step 6: commit**

```bash
git add apps/worker/src/business-discovery.processor.ts apps/worker/test
git commit -m "feat: canonicalize discovered businesses"
```

---

### Task 6: Add idempotent pre-M5 candidate backfill command

**Files:**
- Create: `apps/worker/src/deduplication/canonicalization-backfill.ts`
- Create: `apps/worker/src/backfill-business-candidates.ts`
- Modify: `apps/worker/package.json`
- Create: `apps/worker/test/canonicalization-backfill.integration.test.ts`

**Interfaces:**

```ts
export async function backfillBusinessCandidates(
  database: DatabaseClient,
  options?: { batchSize?: number },
): Promise<{ processed: number; matched: number }>;
```

Package script:

```json
"backfill:business-candidates": "node dist/backfill-business-candidates.js"
```

- [ ] **Step 1: write failing backfill tests**

Seed unmatched pre-M5-style candidates across two workspaces. Assert stable workspace ordering and candidate `createdAt, id` ordering are respected functionally, all candidates become linked, provider duplicates consolidate, and different workspaces remain separate.

- [ ] **Step 2: add idempotency coverage**

Run the backfill twice and assert the second run creates zero additional `Business` rows and leaves existing associations unchanged.

- [ ] **Step 3: run focused tests and verify RED**

- [ ] **Step 4: implement bounded workspace/batch transactions using the same lock and canonicalizer**

Default `batchSize` to `100`; require a positive integer. Each batch transaction acquires the workspace advisory lock, loads currently unmatched candidate IDs in stable order, canonicalizes them, and commits before continuing.

- [ ] **Step 5: implement the CLI entry point**

Load environment/database composition using the worker's existing startup conventions, run the backfill, print only aggregate counts, disconnect cleanly, and exit non-zero on failure without exposing secrets.

- [ ] **Step 6: rerun focused tests and worker typecheck; verify GREEN**

- [ ] **Step 7: commit**

```bash
git add apps/worker
git commit -m "feat: backfill canonical businesses"
```

---

### Task 7: Complete M5 regression, docs, verification, review, and merge readiness

**Files:**
- Modify: `README.md`
- Modify: `docs/milestones/STATUS.md` only after implementation verification succeeds on the feature branch/PR
- Modify: `.github/workflows/ci.yml` only if the branch is not already covered by the current workflow trigger strategy
- Create or modify: M5 verification notes under the repository's existing milestone documentation convention if required by prior milestones

**Interfaces:**
- No new runtime interfaces. This task proves the M5 acceptance criteria and records the result.

- [ ] **Step 1: update README architecture and M5 boundary**

Document canonical `Business`, matching order, confidence/reason audit fields, workspace isolation, local backfill command, and explicit M6 domain-verification boundary.

- [ ] **Step 2: run database validation from a clean schema**

```bash
pnpm db:down
pnpm db:up
pnpm db:deploy
pnpm db:validate
pnpm db:generate
```

- [ ] **Step 3: run all M5 focused tests**

```bash
pnpm --filter @ai-crm/discovery test -- deduplication-normalize.test.ts deduplication-match.test.ts
pnpm --filter @ai-crm/worker test -- business-deduplication.integration.test.ts business-canonicalizer.integration.test.ts canonicalization-backfill.integration.test.ts business-discovery-persistence.integration.test.ts
```

- [ ] **Step 4: run the complete repository verification gate**

```bash
pnpm verify
```

Expected: all package tests, typechecks, ESLint, Prisma generation, and builds pass, including existing Playwright/browser discovery regressions.

- [ ] **Step 5: inspect the feature diff against `main` for scope and migration safety**

Verify there is no M6 website/domain discovery, no AI/embedding code, no new queue, no provider-network change, and no weakening of M4 provenance/cursor behavior.

- [ ] **Step 6: run code review and fix every verified issue with a regression test first where behavior changes**

Re-run `pnpm verify` after the final fix.

- [ ] **Step 7: commit final docs/verification changes**

```bash
git add README.md docs .github/workflows/ci.yml
git commit -m "docs: verify milestone 5 deduplication"
```

Only include `.github/workflows/ci.yml` if it actually changed.

- [ ] **Step 8: open the M5 PR and require exact-head green CI before merge**

PR title:

```text
Milestone 5: Deduplication engine
```

PR body must summarize schema, deterministic matching, fuzzy guardrails, advisory-lock concurrency correctness, backfill, test evidence, and deferred M6+ scope.

- [ ] **Step 9: merge only after review and exact-head CI are green, then verify merge-triggered `main` CI**

After merge-triggered CI succeeds, update `docs/milestones/STATUS.md` so M5 is `Complete` and M6 is `Next` if the repository's established ledger workflow records completion after merge.
