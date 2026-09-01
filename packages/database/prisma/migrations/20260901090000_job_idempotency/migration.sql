ALTER TABLE "JobMetadata"
ADD COLUMN "idempotencyKey" VARCHAR(200);

CREATE UNIQUE INDEX "JobMetadata_queue_workspaceId_idempotencyKey_key"
ON "JobMetadata"("queue", "workspaceId", "idempotencyKey");
