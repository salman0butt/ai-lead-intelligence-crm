import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, type DatabaseClient } from '@ai-crm/database';
import type { QueueService } from '@ai-crm/queue';
import type { CreateCampaignInput } from '@ai-crm/schemas';
import { DATABASE } from '../database/database.module.js';
import { QueueProvider } from '../jobs/queue.provider.js';

@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(QueueProvider) private readonly queue: QueueService,
  ) {}

  async create(userId: string, input: CreateCampaignInput) {
    await this.assertMembership(userId, input.workspaceId);

    return this.db.campaign.create({
      data: {
        workspaceId: input.workspaceId,
        createdByUserId: userId,
        name: input.name,
        country: input.country,
        region: input.region ?? null,
        city: input.city ?? null,
        niche: input.niche,
        requestedLeadCount: input.requestedLeadCount,
      },
    });
  }

  async list(userId: string, workspaceId: string) {
    await this.assertMembership(userId, workspaceId);
    return this.db.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(userId: string, campaignId: string) {
    return this.getAccessibleCampaign(userId, campaignId);
  }

  async start(userId: string, campaignId: string) {
    const campaign = await this.getAccessibleCampaign(userId, campaignId);
    const planningCampaign = await this.transition(
      campaign.id,
      campaign.workspaceId,
      CampaignStatus.DRAFT,
      CampaignStatus.PLANNING,
    );

    try {
      const job = await this.enqueueCampaignPlan(planningCampaign);
      return { campaign: planningCampaign, job };
    } catch (error) {
      await this.rollbackPlanningTransition(
        campaign.id,
        campaign.workspaceId,
        CampaignStatus.DRAFT,
      );
      throw error;
    }
  }

  async pause(userId: string, campaignId: string) {
    const campaign = await this.getAccessibleCampaign(userId, campaignId);
    return this.transition(
      campaign.id,
      campaign.workspaceId,
      [CampaignStatus.PLANNING, CampaignStatus.DISCOVERING],
      CampaignStatus.PAUSED,
    );
  }

  async resume(userId: string, campaignId: string) {
    const campaign = await this.getAccessibleCampaign(userId, campaignId);
    const planningCampaign = await this.transition(
      campaign.id,
      campaign.workspaceId,
      CampaignStatus.PAUSED,
      CampaignStatus.PLANNING,
    );

    try {
      await this.enqueueCampaignPlan(planningCampaign);
      return planningCampaign;
    } catch (error) {
      await this.rollbackPlanningTransition(
        campaign.id,
        campaign.workspaceId,
        CampaignStatus.PAUSED,
      );
      throw error;
    }
  }

  async cancel(userId: string, campaignId: string) {
    const campaign = await this.getAccessibleCampaign(userId, campaignId);
    return this.transition(
      campaign.id,
      campaign.workspaceId,
      [
        CampaignStatus.DRAFT,
        CampaignStatus.PLANNING,
        CampaignStatus.DISCOVERING,
        CampaignStatus.PAUSED,
      ],
      CampaignStatus.CANCELLED,
    );
  }

  private async enqueueCampaignPlan(campaign: {
    id: string;
    workspaceId: string;
    updatedAt: Date;
  }) {
    return this.queue.enqueue(
      'campaign-plan',
      { workspaceId: campaign.workspaceId, campaignId: campaign.id },
      {
        idempotencyKey: `campaign-plan:${campaign.id}:${campaign.updatedAt.toISOString()}`,
      },
    );
  }

  private async rollbackPlanningTransition(
    campaignId: string,
    workspaceId: string,
    previousStatus: CampaignStatus.DRAFT | CampaignStatus.PAUSED,
  ): Promise<void> {
    await this.db.campaign.updateMany({
      where: {
        id: campaignId,
        workspaceId,
        status: CampaignStatus.PLANNING,
      },
      data: { status: previousStatus },
    });
  }

  private async getAccessibleCampaign(userId: string, campaignId: string) {
    const campaign = await this.db.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    await this.assertMembership(userId, campaign.workspaceId);
    return campaign;
  }

  private async assertMembership(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw new ForbiddenException('Workspace access denied');
  }

  private async transition(
    campaignId: string,
    workspaceId: string,
    expected: CampaignStatus | readonly CampaignStatus[],
    next: CampaignStatus,
  ) {
    return this.db.$transaction(async (tx) => {
      const status = typeof expected === 'string' ? expected : { in: [...expected] };
      const result = await tx.campaign.updateMany({
        where: { id: campaignId, workspaceId, status },
        data: { status: next },
      });
      if (result.count !== 1) throw new ConflictException('Campaign state changed; refresh and try again');

      const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) throw new NotFoundException('Campaign not found');
      return campaign;
    });
  }
}
