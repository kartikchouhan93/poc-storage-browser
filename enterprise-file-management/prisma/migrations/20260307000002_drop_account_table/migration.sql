-- Migration: Drop Account table and clean up related references
-- The Account model is superseded by AwsAccount (IAM role assumption)

-- Step 1: Drop FK from Bucket → Account
ALTER TABLE "Bucket" DROP CONSTRAINT IF EXISTS "Bucket_accountId_fkey";

-- Step 2: Drop the accountId column from Bucket
ALTER TABLE "Bucket" DROP COLUMN IF EXISTS "accountId";

-- Step 3: Drop all FKs on Account table
ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_tenantId_fkey";
ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_createdBy_fkey";
ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_updatedBy_fkey";

-- Step 4: Drop the Account table
DROP TABLE IF EXISTS "Account";
