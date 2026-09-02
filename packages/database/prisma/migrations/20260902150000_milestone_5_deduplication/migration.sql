CREATE TYPE "public"."DuplicateReason" AS ENUM (
  'PROVIDER_EXTERNAL_ID',
  'CANONICAL_DOMAIN',
  'PHONE',
  'NAME_ADDRESS_EXACT',
  'NAME_CITY_POSTAL_EXACT',
  'FUZZY_HIGH_CONFIDENCE',
  'FUZZY_LOW_CONFIDENCE_NOT_MERGED',
  'NEW_CANONICAL'
);

CREATE TABLE "public"."Business" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "name" VARCHAR(240) NOT NULL,
  "normalizedName" VARCHAR(240) NOT NULL,
  "formattedAddress" TEXT NOT NULL,
  "normalizedAddress" TEXT NOT NULL,
  "city" VARCHAR(120),
  "normalizedCity" VARCHAR(120),
  "postalCode" VARCHAR(40),
  "normalizedPostalCode" VARCHAR(40),
  "phone" VARCHAR(64),
  "normalizedPhone" VARCHAR(64),
  "canonicalDomain" VARCHAR(253),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."BusinessCandidate"
  ADD COLUMN "city" VARCHAR(120),
  ADD COLUMN "postalCode" VARCHAR(40),
  ADD COLUMN "phone" VARCHAR(64),
  ADD COLUMN "canonicalDomain" VARCHAR(253),
  ADD COLUMN "matchedBusinessId" UUID,
  ADD COLUMN "duplicateConfidence" DOUBLE PRECISION,
  ADD COLUMN "duplicateReason" "public"."DuplicateReason";

CREATE INDEX "Business_workspaceId_canonicalDomain_idx"
  ON "public"."Business"("workspaceId", "canonicalDomain");
CREATE INDEX "Business_workspaceId_normalizedPhone_idx"
  ON "public"."Business"("workspaceId", "normalizedPhone");
CREATE INDEX "Business_workspaceId_normalizedName_normalizedAddress_idx"
  ON "public"."Business"("workspaceId", "normalizedName", "normalizedAddress");
CREATE INDEX "Business_workspaceId_normalizedName_normalizedCity_normalizedPostalCode_idx"
  ON "public"."Business"("workspaceId", "normalizedName", "normalizedCity", "normalizedPostalCode");
CREATE INDEX "Business_workspaceId_normalizedCity_idx"
  ON "public"."Business"("workspaceId", "normalizedCity");
CREATE INDEX "Business_workspaceId_normalizedPostalCode_idx"
  ON "public"."Business"("workspaceId", "normalizedPostalCode");

CREATE INDEX "BusinessCandidate_workspaceId_provider_providerExternalId_idx"
  ON "public"."BusinessCandidate"("workspaceId", "provider", "providerExternalId");
CREATE INDEX "BusinessCandidate_matchedBusinessId_idx"
  ON "public"."BusinessCandidate"("matchedBusinessId");

ALTER TABLE "public"."Business"
  ADD CONSTRAINT "Business_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."BusinessCandidate"
  ADD CONSTRAINT "BusinessCandidate_matchedBusinessId_fkey"
  FOREIGN KEY ("matchedBusinessId") REFERENCES "public"."Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;