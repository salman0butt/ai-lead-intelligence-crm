import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, WorkspacesModule, JobsModule, CampaignsModule],
  controllers: [HealthController],
})
export class AppModule {}
