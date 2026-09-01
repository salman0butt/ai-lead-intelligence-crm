import type { DatabaseClient } from '@ai-crm/database';
import type { QueueWorkJob } from '@ai-crm/queue';

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
  await database.jobMetadata.update({
    where: { jobId: job.id },
    data: {
      status: 'RUNNING',
      attempts: { increment: 1 },
      startedAt: new Date(),
      finishedAt: null,
      failureReason: null,
    },
  });

  try {
    await task(job);
    await database.jobMetadata.update({
      where: { jobId: job.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        failureReason: null,
      },
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await database.jobMetadata.update({
      where: { jobId: job.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        failureReason,
      },
    });
    throw error;
  }
}
