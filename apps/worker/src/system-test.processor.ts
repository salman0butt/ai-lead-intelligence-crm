import type { DatabaseClient } from '@ai-crm/database';
import type { QueueWorkJob } from '@ai-crm/queue';
import { processTrackedJob } from './tracked-job.js';

export type SystemTestTask = (job: QueueWorkJob) => Promise<void>;

const defaultTask: SystemTestTask = async (job) => {
  if (job.data.fail === 'true') {
    throw new Error('Synthetic system-test failure');
  }
};

export async function processSystemTestJob(
  database: DatabaseClient,
  job: QueueWorkJob,
  task: SystemTestTask = defaultTask,
): Promise<void> {
  return processTrackedJob(database, job, task);
}
