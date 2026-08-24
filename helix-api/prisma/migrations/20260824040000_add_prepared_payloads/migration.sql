-- CreateTable
CREATE TABLE "prepared_payloads" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "unsignedPayload" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "expectedSignerDid" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prepared_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prepared_payloads_token_key" ON "prepared_payloads"("token");
