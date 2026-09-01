ALTER TYPE "public"."CampaignStatus" ADD VALUE 'DISCOVERING';

ALTER TABLE "public"."SearchTask"
  ADD COLUMN "nextPageToken" TEXT,
  ADD COLUMN "pageNumber" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "public"."BusinessCandidate" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "providerExternalId" VARCHAR(255) NOT NULL,
  "name" VARCHAR(240) NOT NULL,
  "formattedAddress" TEXT NOT NULL,
  "category" VARCHAR(160),
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "rawReference" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."BusinessSource" (
  "id" UUID NOT NULL,
  "businessCandidateId" UUID NOT NULL,
  "searchTaskId" UUID NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "providerExternalId" VARCHAR(255) NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ProviderUsage" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "rateLimitCount" INTEGER NOT NULL DEFAULT 0,
  "costAmount" DECIMAL(18,6),
  "costCurrency" VARCHAR(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessCandidate_campaignId_provider_providerExternalId_key"
  ON "public"."BusinessCandidate"("campaignId", "provider", "providerExternalId");
CREATE INDEX "BusinessCandidate_workspaceId_campaignId_idx"
  ON "public"."BusinessCandidate"("workspaceId", "campaignId");
CREATE INDEX "BusinessCandidate_campaignId_provider_idx"
  ON "public"."BusinessCandidate"("campaignId", "provider");

CREATE UNIQUE INDEX "BusinessSource_businessCandidateId_searchTaskId_key"
  ON "public"."BusinessSource"("businessCandidateId", "searchTaskId");
CREATE INDEX "BusinessSource_searchTaskId_idx"
  ON "public"."BusinessSource"("searchTaskId");
CREATE INDEX "BusinessSource_provider_providerExternalId_idx"
  ON "public"."BusinessSource"("provider", "providerExternalId");

CREATE UNIQUE INDEX "ProviderUsage_campaignId_provider_key"
  ON "public"."ProviderUsage"("campaignId", "provider");
CREATE INDEX "ProviderUsage_workspaceId_campaignId_idx"
  ON "public"."ProviderUsage"("workspaceId", "campaignId");

ALTER TABLE "public"."BusinessCandidate"
  ADD CONSTRAINT "BusinessCandidate_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."BusinessCandidate"
  ADD CONSTRAINT "BusinessCandidate_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."BusinessSource"
  ADD CONSTRAINT "BusinessSource_businessCandidateId_fkey"
  FOREIGN KEY ("businessCandidateId") REFERENCES "public"."BusinessCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."BusinessSource"
  ADD CONSTRAINT "BusinessSource_searchTaskId_fkey"
  FOREIGN KEY ("searchTaskId") REFERENCES "public"."SearchTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ProviderUsage"
  ADD CONSTRAINT "ProviderUsage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ProviderUsage"
  ADD CONSTRAINT "ProviderUsage_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
