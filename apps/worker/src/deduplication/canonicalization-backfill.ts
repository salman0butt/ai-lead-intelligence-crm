import type { DatabaseClient } from '@ai-crm/database';
import { canonicalizeBusinessCandidate } from './business-canonicalizer.js';
import { acquireWorkspaceCanonicalizationLock } from './workspace-lock.js';

export interface CanonicalizationBackfillResult {
  processed: number;
  matched: number;
}

export async function backfillBusinessCandidates(
  database: DatabaseClient,
  batchSize: number,
): Promise<CanonicalizationBackfillResult> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('canonicalization backfill batch size must be a positive integer');
  }

  let processed = 0;
  let matched = 0;

  while (true) {
    const candidates = await database.businessCandidate.findMany({
      where: { matchedBusinessId: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { id: true, workspaceId: true },
    });

    if (candidates.length === 0) break;

    const batchMatched = await database.$transaction(async (tx) => {
      const workspaceIds = [...new Set(candidates.map((candidate) => candidate.workspaceId))]
        .sort((left, right) => left.localeCompare(right));

      for (const workspaceId of workspaceIds) {
        await acquireWorkspaceCanonicalizationLock(tx, workspaceId);
      }

      let canonicalized = 0;
      for (const candidate of candidates) {
        await canonicalizeBusinessCandidate(tx, candidate.id);
        canonicalized += 1;
      }
      return canonicalized;
    });

    processed += candidates.length;
    matched += batchMatched;
  }

  return { processed, matched };
}
