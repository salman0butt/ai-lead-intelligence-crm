import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createPrismaClient>;
export type DatabaseTransactionClient = Omit<
  DatabaseClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
