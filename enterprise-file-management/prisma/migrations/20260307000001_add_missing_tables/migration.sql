-- CreateEnum
CREATE TYPE "AccountValidationStatus" AS ENUM ('CREATING', 'PENDING_VALIDATION', 'CONNECTED', 'FAILED', 'DISCONNECTED', 'DELETED');

-- CreateTable: BotIdentity
CREATE TABLE "BotIdentity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "permissions" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "agentStatus" TEXT DEFAULT 'UNKNOWN',
    "heartbeatLogs" JSONB,
    "diagnostics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AwsAccount
CREATE TABLE "AwsAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "awsAccountId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "roleArn" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "friendlyName" TEXT NOT NULL,
    "description" TEXT,
    "status" "AccountValidationStatus" NOT NULL DEFAULT 'CREATING',
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MultipartUpload
CREATE TABLE "MultipartUpload" (
    "id" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "MultipartUpload_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Bucket - make accountId nullable, add awsAccountId and eventBridgeRuleArn
-- Note: auditing fields and tenantId already exist from previous migrations
ALTER TABLE "Bucket"
    ALTER COLUMN "accountId" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "awsAccountId" TEXT,
    ADD COLUMN IF NOT EXISTS "eventBridgeRuleArn" TEXT;

-- CreateIndex: AwsAccount unique awsAccountId
CREATE UNIQUE INDEX "AwsAccount_awsAccountId_key" ON "AwsAccount"("awsAccountId");

-- CreateIndex: MultipartUpload unique fileHash+userId
CREATE UNIQUE INDEX "MultipartUpload_fileHash_userId_key" ON "MultipartUpload"("fileHash", "userId");

-- CreateIndex: BotIdentity indexes
CREATE INDEX "BotIdentity_userId_idx" ON "BotIdentity"("userId");
CREATE INDEX "BotIdentity_tenantId_idx" ON "BotIdentity"("tenantId");

-- AddForeignKey: BotIdentity
ALTER TABLE "BotIdentity" ADD CONSTRAINT "BotIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BotIdentity" ADD CONSTRAINT "BotIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: AwsAccount
ALTER TABLE "AwsAccount" ADD CONSTRAINT "AwsAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: MultipartUpload
ALTER TABLE "MultipartUpload" ADD CONSTRAINT "MultipartUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: AwsAccount → Bucket
ALTER TABLE "Bucket" ADD CONSTRAINT "Bucket_awsAccountId_fkey" FOREIGN KEY ("awsAccountId") REFERENCES "AwsAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
