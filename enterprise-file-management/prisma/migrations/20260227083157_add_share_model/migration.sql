-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "downloadLimit" INTEGER NOT NULL DEFAULT 3,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "passwordProtected" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "status" "ShareStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Share_fileId_idx" ON "Share"("fileId");

-- CreateIndex
CREATE INDEX "Share_tenantId_idx" ON "Share"("tenantId");

-- CreateIndex
CREATE INDEX "Share_bucketId_idx" ON "Share"("bucketId");

-- CreateIndex
CREATE INDEX "Share_toEmail_idx" ON "Share"("toEmail");

-- CreateIndex
CREATE INDEX "Share_status_idx" ON "Share"("status");

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "Bucket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
