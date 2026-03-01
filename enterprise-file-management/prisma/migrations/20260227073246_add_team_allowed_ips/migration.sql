-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "allowedIps" TEXT;
