-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "dids" ADD COLUMN     "hederaSequenceNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hederaTopicId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "publicKeyMultibase" TEXT;

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
CREATE INDEX "audit_log_eventType_idx" ON "audit_log"("eventType");

-- CreateIndex
CREATE INDEX "audit_log_requestId_idx" ON "audit_log"("requestId");

-- CreateIndex
CREATE INDEX "dids_id_idx" ON "dids"("id");

-- CreateIndex
CREATE INDEX "dids_publicKey_idx" ON "dids"("publicKey");

-- CreateIndex
CREATE INDEX "vcs_subjectDid_idx" ON "vcs"("subjectDid");

-- CreateIndex
CREATE INDEX "vcs_vcId_idx" ON "vcs"("vcId");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_enrollmentTokenId_fkey" FOREIGN KEY ("enrollmentTokenId") REFERENCES "enrollment_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
