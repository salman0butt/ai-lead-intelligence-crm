-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "JobMetadata" (
    "jobId" UUID NOT NULL,
    "queue" VARCHAR(80) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "workspaceId" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "JobMetadata_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "JobMetadata_workspaceId_status_idx" ON "JobMetadata"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "JobMetadata_queue_status_idx" ON "JobMetadata"("queue", "status");

-- AddForeignKey
ALTER TABLE "JobMetadata" ADD CONSTRAINT "JobMetadata_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
