CREATE TYPE "public"."SearchTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "public"."SearchPlan" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."SearchTask" (
  "id" UUID NOT NULL,
  "searchPlanId" UUID NOT NULL,
  "country" VARCHAR(120) NOT NULL,
  "region" VARCHAR(120) NOT NULL DEFAULT '',
  "city" VARCHAR(120) NOT NULL DEFAULT '',
  "geographicCell" VARCHAR(160) NOT NULL DEFAULT '',
  "query" VARCHAR(200) NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "status" "public"."SearchTaskStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "uniqueBusinessCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchPlan_campaignId_key" ON "public"."SearchPlan"("campaignId");
CREATE INDEX "SearchPlan_workspaceId_idx" ON "public"."SearchPlan"("workspaceId");
CREATE UNIQUE INDEX "SearchTask_searchPlanId_provider_country_region_city_query_key"
  ON "public"."SearchTask"("searchPlanId", "provider", "country", "region", "city", "query");
CREATE INDEX "SearchTask_searchPlanId_status_idx" ON "public"."SearchTask"("searchPlanId", "status");

ALTER TABLE "public"."SearchPlan"
  ADD CONSTRAINT "SearchPlan_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."SearchPlan"
  ADD CONSTRAINT "SearchPlan_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."SearchTask"
  ADD CONSTRAINT "SearchTask_searchPlanId_fkey"
  FOREIGN KEY ("searchPlanId") REFERENCES "public"."SearchPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
