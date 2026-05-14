DROP TABLE IF EXISTS "vcs";

CREATE TABLE "vcs" (
  "id" TEXT NOT NULL,
  "vcId" TEXT NOT NULL,
  "subjectDid" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "vcJson" TEXT NOT NULL,
  "privilegeScopes" TEXT NOT NULL,
  "statusListIndex" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "renewedByVcId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vcs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vcs_vcId_key" ON "vcs"("vcId");
CREATE INDEX "vcs_subjectDid_idx" ON "vcs"("subjectDid");
CREATE INDEX "vcs_vcId_idx" ON "vcs"("vcId");

CREATE TABLE "status_list_entries" (
  "id" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "encodedList" TEXT NOT NULL,
  "nextIndex" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "status_list_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "status_list_entries_listId_key" ON "status_list_entries"("listId");
