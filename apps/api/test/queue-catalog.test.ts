import { describe, expect, it } from 'vitest';
import { APPLICATION_QUEUES, queueDefinitions } from '../../../packages/queue/src/queues.js';

describe('milestone 1 queue catalog', () => {
  it('defines every required application queue with durable defaults', () => {
    expect(APPLICATION_QUEUES).toEqual([
      'system-test',
      'campaign-plan',
      'campaign-discovery',
      'business-enrichment',
      'website-crawl',
      'business-research',
      'outreach-generation',
    ]);

    expect(queueDefinitions).toHaveLength(APPLICATION_QUEUES.length);

    for (const queue of queueDefinitions) {
      expect(queue.concurrency).toBeGreaterThanOrEqual(1);
      expect(queue.retryLimit).toBe(3);
      expect(queue.retryDelay).toBe(5);
      expect(queue.retryBackoff).toBe(true);
      expect(queue.retryDelayMax).toBe(300);
      expect(queue.expireInSeconds).toBe(900);
      expect(queue.heartbeatSeconds).toBe(60);
      expect(queue.deadLetter).toBe(`${queue.name}-dlq`);
    }
  });
});
