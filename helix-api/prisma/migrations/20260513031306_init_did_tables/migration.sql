-- CreateTable
CREATE TABLE "vp_ids" (
    "id" TEXT NOT NULL,
    "vpId" TEXT NOT NULL,
    "agentDid" TEXT NOT NULL,
    "userDid" TEXT NOT NULL,
    "targetService" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vp_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "requestedScopes" TEXT NOT NULL,
    "requestedDomains" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "pendingPublicKeyHex" TEXT,
    "pendingDomains" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrollmentTokenId" TEXT,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_registry" (
    "id" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "verifiedDomain" TEXT NOT NULL,
    "publicKeyMultibase" TEXT NOT NULL,
    "apiEndpoint" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcs" (
    "id" TEXT NOT NULL,
    "vcId" TEXT NOT NULL,
    "subjectDid" TEXT NOT NULL,
    "issuerDid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "vcJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dids" (
    "id" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "publicKeyHex" TEXT NOT NULL,
    "publicKeyMultibase" TEXT NOT NULL,
    "hederaTopicId" TEXT NOT NULL DEFAULT '',
    "hederaSequenceNumber" INTEGER NOT NULL DEFAULT 0,
    "hederaTransactionId" TEXT NOT NULL,
    "didDocumentJson" TEXT NOT NULL,
    "deactivated" BOOLEAN NOT NULL DEFAULT false,
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
    "updatePayloadJson" TEXT NOT NULL,
    "hederaTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "did_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vp_ids_vpId_key" ON "vp_ids"("vpId");

-- CreateIndex
CREATE INDEX "vp_ids_vpId_idx" ON "vp_ids"("vpId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_tokens_tokenHash_key" ON "enrollment_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "challenges_challengeId_key" ON "challenges"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "service_registry_serviceName_key" ON "service_registry"("serviceName");

-- CreateIndex
CREATE UNIQUE INDEX "vcs_vcId_key" ON "vcs"("vcId");

-- CreateIndex
CREATE INDEX "vcs_subjectDid_idx" ON "vcs"("subjectDid");

-- CreateIndex
CREATE UNIQUE INDEX "dids_did_key" ON "dids"("did");

-- CreateIndex
CREATE INDEX "dids_did_idx" ON "dids"("did");

-- CreateIndex
CREATE INDEX "audit_log_eventType_idx" ON "audit_log"("eventType");

-- CreateIndex
CREATE INDEX "audit_log_requestId_idx" ON "audit_log"("requestId");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_enrollmentTokenId_fkey" FOREIGN KEY ("enrollmentTokenId") REFERENCES "enrollment_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "did_updates" ADD CONSTRAINT "did_updates_didId_fkey" FOREIGN KEY ("didId") REFERENCES "dids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
