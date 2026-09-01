import type { DatabaseClient } from '@ai-crm/database';
import type { QueueWorkJob } from '@ai-crm/queue';

export type TrackedJobTask = (job: QueueWorkJob) => Promise<void>;

export async function processTrackedJob(
  database: DatabaseClient,
  job: QueueWorkJob,
  task: TrackedJobTask,
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
