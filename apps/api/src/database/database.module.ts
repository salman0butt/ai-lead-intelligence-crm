import { Global, Module } from '@nestjs/common';
import { loadServerEnv } from '@ai-crm/config';
import { createPrismaClient } from '@ai-crm/database';

export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: () => {
        const env = loadServerEnv(process.env);
        return createPrismaClient(env.DATABASE_URL);
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
