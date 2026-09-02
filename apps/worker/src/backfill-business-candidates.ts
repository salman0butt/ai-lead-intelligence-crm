import { loadServerEnv } from '@ai-crm/config';
import { createPrismaClient } from '@ai-crm/database';
import { backfillBusinessCandidates } from './deduplication/canonicalization-backfill.js';

async function main(): Promise<void> {
  const env = loadServerEnv(process.env);
  const database = createPrismaClient(env.DATABASE_URL);

  try {
    const result = await backfillBusinessCandidates(database);
    console.info(`processed=${result.processed} matched=${result.matched}`);
  } finally {
    await database.$disconnect();
  }
}

void main().catch(() => {
  console.error('business candidate backfill failed');
  process.exitCode = 1;
});
