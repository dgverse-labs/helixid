-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "accounts" ADD COLUMN "emailVerificationTokenHash" TEXT;
ALTER TABLE "accounts" ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);
