CREATE TYPE "public"."CampaignStatus" AS ENUM ('DRAFT', 'PLANNING', 'PAUSED', 'CANCELLED');

CREATE TABLE "public"."Campaign" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "country" VARCHAR(120) NOT NULL,
  "region" VARCHAR(120),
  "city" VARCHAR(120),
  "niche" VARCHAR(160) NOT NULL,
  "requestedLeadCount" INTEGER NOT NULL,
  "status" "public"."CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Campaign_workspaceId_createdAt_idx" ON "public"."Campaign"("workspaceId", "createdAt");
CREATE INDEX "Campaign_workspaceId_status_idx" ON "public"."Campaign"("workspaceId", "status");

ALTER TABLE "public"."Campaign"
  ADD CONSTRAINT "Campaign_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Campaign"
  ADD CONSTRAINT "Campaign_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
