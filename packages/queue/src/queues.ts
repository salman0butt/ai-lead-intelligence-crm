export const APPLICATION_QUEUES = [
  'system-test',
  'campaign-plan',
  'campaign-discovery',
  'business-enrichment',
  'website-crawl',
  'business-research',
  'outreach-generation',
] as const;

export type QueueName = (typeof APPLICATION_QUEUES)[number];

export interface QueueDefinition {
  name: QueueName;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax: number;
  expireInSeconds: number;
  retentionSeconds: number;
  deleteAfterSeconds: number;
  heartbeatSeconds: number;
  deadLetter: string;
}

export function deadLetterQueueName(queue: QueueName): string {
  return `${queue}-dlq`;
}

export const queueDefinitions: readonly QueueDefinition[] = APPLICATION_QUEUES.map((name) => ({
  name,
  retryLimit: 3,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 900,
  retentionSeconds: 60 * 60 * 24 * 14,
  deleteAfterSeconds: 60 * 60 * 24 * 7,
  heartbeatSeconds: 60,
  deadLetter: deadLetterQueueName(name),
}));
