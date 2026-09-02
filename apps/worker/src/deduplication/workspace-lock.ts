import type { DatabaseTransactionClient } from '@ai-crm/database';

export async function acquireWorkspaceCanonicalizationLock(
  tx: DatabaseTransactionClient,
  workspaceId: string,
): Promise<void> {
  if (!workspaceId) {
    throw new Error('workspace canonicalization lock requires workspaceId');
  }

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(CAST(${workspaceId} AS text), CAST(0 AS bigint))
    )
  `;
}
