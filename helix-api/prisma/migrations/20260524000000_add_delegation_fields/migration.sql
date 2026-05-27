ALTER TABLE "vcs"
  ADD COLUMN "delegatedFrom" TEXT,
  ADD COLUMN "delegationDepth" INTEGER,
  ADD COLUMN "maxDelegationDepth" INTEGER,
  ADD COLUMN "parentVcId" TEXT;

CREATE INDEX "vcs_parentVcId_idx" ON "vcs"("parentVcId");

ALTER TABLE "enrollment_tokens"
  ADD COLUMN "maxDelegationDepth" INTEGER NOT NULL DEFAULT 0;
