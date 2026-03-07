-- AlterTable: User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: Tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "isHubTenant" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: FileObject
ALTER TABLE "FileObject" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "FileObject" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- AlterTable: AuditLog
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- AlterTable: ResourcePolicy
ALTER TABLE "ResourcePolicy" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "ResourcePolicy" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- AlterTable: Bucket
ALTER TABLE "Bucket" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Bucket" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- AddForeignKeys for auditing fields
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: AuditLog foreign keys might already exist or need adding
-- but based on \d User output they seem to be there for AuditLog.

-- AddForeignKeys for Bucket auditing
ALTER TABLE "Bucket" ADD CONSTRAINT "Bucket_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Bucket" ADD CONSTRAINT "Bucket_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKeys for ResourcePolicy auditing
ALTER TABLE "ResourcePolicy" ADD CONSTRAINT "ResourcePolicy_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResourcePolicy" ADD CONSTRAINT "ResourcePolicy_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
