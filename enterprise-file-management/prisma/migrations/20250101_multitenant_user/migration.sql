-- Migration: multitenant_user
-- Description: Converts User model to support multi-tenant assignment via composite unique key.
--              Each email+tenantId combination is a distinct User row.

-- Step 1: Backfill null tenantIds from the first available tenant
--         (prevents ALTER COLUMN NOT NULL from failing on existing rows)
UPDATE "User"
SET "tenantId" = (SELECT id FROM "Tenant" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "tenantId" IS NULL;

-- Step 2: Drop the single-column unique index on email
DROP INDEX IF EXISTS "User_email_key";

-- Step 3: Drop the single-column unique index on cognitoSub
DROP INDEX IF EXISTS "User_cognitoSub_key";

-- Step 4: Add composite unique index on [email, tenantId]
CREATE UNIQUE INDEX "User_email_tenantId_key" ON "User"("email", "tenantId");

-- Step 5: Add regular index on cognitoSub (for efficient lookups without uniqueness)
CREATE INDEX "User_cognitoSub_idx" ON "User"("cognitoSub");

-- Step 6: Add regular index on email (for findMany queries by email)
CREATE INDEX "User_email_idx" ON "User"("email");

-- Step 7: Drop theme preference columns (moved to localStorage)
ALTER TABLE "User" DROP COLUMN IF EXISTS "themeMode";
ALTER TABLE "User" DROP COLUMN IF EXISTS "themeColor";
ALTER TABLE "User" DROP COLUMN IF EXISTS "themeFont";
ALTER TABLE "User" DROP COLUMN IF EXISTS "themeRadius";

-- Step 8: Make tenantId non-nullable (safe after Step 1 backfill)
ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;
