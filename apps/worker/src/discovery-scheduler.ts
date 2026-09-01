import type { QueueJobResult, QueueService } from '@ai-crm/queue';

export interface DiscoveryJobPayloadInput {
  workspaceId: string;
  campaignId: string;
  searchTaskId: string;
  campaignVersion: string;
  pageNumber: string;
}

export async function scheduleSearchTaskDiscovery(
  queue: QueueService,
  input: DiscoveryJobPayloadInput,
): Promise<QueueJobResult> {
  return queue.enqueue(
    'campaign-discovery',
    {
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      searchTaskId: input.searchTaskId,
      campaignVersion: input.campaignVersion,
      pageNumber: input.pageNumber,
    },
    {
      idempotencyKey:
        `campaign-discovery:${input.searchTaskId}:${input.campaignVersion}:page:${input.pageNumber}`,
    },
  );
}
