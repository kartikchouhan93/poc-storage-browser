/*
  Warnings:

  - Added the required column `tenantId` to the `Bucket` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `FileObject` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Bucket" ADD COLUMN "tenantId" TEXT DEFAULT 'cmlufleww0000ydbphwyszvnq';
UPDATE "Bucket" SET "tenantId" = 'cmlufleww0000ydbphwyszvnq' WHERE "tenantId" IS NULL;
ALTER TABLE "Bucket" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Bucket" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN "tenantId" TEXT DEFAULT 'cmlufleww0000ydbphwyszvnq';
UPDATE "FileObject" SET "tenantId" = 'cmlufleww0000ydbphwyszvnq' WHERE "tenantId" IS NULL;
ALTER TABLE "FileObject" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "FileObject" ALTER COLUMN "tenantId" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "FileObject_tenantId_idx" ON "FileObject"("tenantId");

-- AddForeignKey
ALTER TABLE "Bucket" ADD CONSTRAINT "Bucket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
