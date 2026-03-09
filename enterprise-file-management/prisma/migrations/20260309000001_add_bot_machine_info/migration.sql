-- AlterTable: BotIdentity - add machineInfo column missing from initial migration
ALTER TABLE "BotIdentity" ADD COLUMN IF NOT EXISTS "machineInfo" JSONB;
