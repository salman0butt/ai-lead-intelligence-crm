import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, WorkspacesModule],
  controllers: [HealthController],
})
export class AppModule {}
