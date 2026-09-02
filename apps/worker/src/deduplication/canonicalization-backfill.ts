import type { DatabaseClient } from '@ai-crm/database';
import { canonicalizeBusinessCandidate } from './business-canonicalizer.js';
import { acquireWorkspaceCanonicalizationLock } from './workspace-lock.js';

export interface CanonicalizationBackfillOptions {
  batchSize?: number;
}

export interface CanonicalizationBackfillResult {
  processed: number;
  matched: number;
}

export async function backfillBusinessCandidates(
  database: DatabaseClient,
  options: CanonicalizationBackfillOptions = {},
): Promise<CanonicalizationBackfillResult> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('canonicalization backfill batch size must be a positive integer');
  }

  let processed = 0;
  let matched = 0;

  while (true) {
    const nextCandidate = await database.businessCandidate.findFirst({
      where: { matchedBusinessId: null },
      orderBy: [
        { workspaceId: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: { workspaceId: true },
    });

    if (!nextCandidate) break;

    const batchMatched = await database.$transaction(async (tx) => {
      await acquireWorkspaceCanonicalizationLock(tx, nextCandidate.workspaceId);

      const candidates = await tx.businessCandidate.findMany({
        where: {
          workspaceId: nextCandidate.workspaceId,
          matchedBusinessId: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });

      for (const candidate of candidates) {
        await canonicalizeBusinessCandidate(tx, candidate.id);
      }

      return candidates.length;
    });

    processed += batchMatched;
    matched += batchMatched;
  }

  return { processed, matched };
}
