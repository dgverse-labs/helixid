-- CreateTable
CREATE TABLE "dids" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "controller" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "hederaTransactionId" TEXT NOT NULL,
    "didDocument" JSONB NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "did_updates" (
    "id" TEXT NOT NULL,
    "didId" TEXT NOT NULL,
    "updateType" TEXT NOT NULL,
    "hederaTransactionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "did_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcs" (
    "id" TEXT NOT NULL,
    "vcId" TEXT NOT NULL,
    "subjectDid" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "vcJson" JSONB NOT NULL,
    "privilegeScopes" JSONB,
    "statusListIndex" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "renewedByVcId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_list_entries" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "encodedList" TEXT NOT NULL,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vcs_vcId_key" ON "vcs"("vcId");

-- CreateIndex
CREATE UNIQUE INDEX "status_list_entries_listId_key" ON "status_list_entries"("listId");

-- AddForeignKey
ALTER TABLE "did_updates" ADD CONSTRAINT "did_updates_didId_fkey" FOREIGN KEY ("didId") REFERENCES "dids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcs" ADD CONSTRAINT "vcs_subjectDid_fkey" FOREIGN KEY ("subjectDid") REFERENCES "dids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
