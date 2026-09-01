import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createCampaignSchema } from '@ai-crm/schemas';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseWithSchema } from '../validation/zod.js';
import { CampaignsService } from './campaigns.service.js';

const campaignListSchema = createCampaignSchema.pick({ workspaceId: true });

@Controller('campaigns')
@UseGuards(AuthGuard)
export class CampaignsController {
  constructor(@Inject(CampaignsService) private readonly campaignsService: CampaignsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.campaignsService.create(user.id, parseWithSchema(createCampaignSchema, body));
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('workspaceId') workspaceId: unknown) {
    const input = parseWithSchema(campaignListSchema, { workspaceId });
    return this.campaignsService.list(user.id, input.workspaceId);
  }

  @Get(':campaignId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
  ) {
    return this.campaignsService.get(user.id, campaignId);
  }

  @Post(':campaignId/start')
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
  ) {
    return this.campaignsService.start(user.id, campaignId);
  }

  @Post(':campaignId/pause')
  pause(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
  ) {
    return this.campaignsService.pause(user.id, campaignId);
  }

  @Post(':campaignId/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
  ) {
    return this.campaignsService.resume(user.id, campaignId);
  }

  @Post(':campaignId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
  ) {
    return this.campaignsService.cancel(user.id, campaignId);
  }
}
