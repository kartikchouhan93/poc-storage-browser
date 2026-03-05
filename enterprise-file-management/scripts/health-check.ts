import "dotenv/config";
import prisma from "../lib/prisma";
import { AccountValidationStatus, Role } from "../lib/generated/prisma/client";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { getTenantAwsCredentials } from "../lib/aws/sts";
import { decrypt } from "../lib/encryption";

/**
 * Health check script to be run periodically via cron (e.g. every 2-4 hours).
 * Tests all CONNECTED accounts to ensure we haven't lost access (e.g., role deleted or trust policy revoked).
 */
async function runHealthCheck() {
  console.log("Starting AWS Account Health Check...");

  // Find a reliable system user for audit logs (Platform Admin)
  const systemAdmin = await prisma.user.findFirst({
    where: { role: Role.PLATFORM_ADMIN },
  });
  const auditUserId = systemAdmin ? systemAdmin.id : "system";

  const accounts = await prisma.awsAccount.findMany({
    where: { status: AccountValidationStatus.CONNECTED },
  });

  console.log(`Found ${accounts.length} connected accounts.`);

  for (const account of accounts) {
    try {
      console.log(
        `Checking account ${account.awsAccountId} (Tenant: ${account.tenantId})...`,
      );

      const decryptedExternalId = decrypt(account.externalId);

      const credentials = await getTenantAwsCredentials(
        account.roleArn,
        decryptedExternalId,
      );

      const stsClient = new STSClient({
        region: account.region,
        credentials,
      });
      await stsClient.send(new GetCallerIdentityCommand({}));

      console.log(`✅ Account ${account.awsAccountId} remains healthy.`);
    } catch (error: any) {
      console.error(
        `❌ Health check failed for ${account.awsAccountId}:`,
        error.message,
      );

      await prisma.awsAccount.update({
        where: { id: account.id },
        data: {
          status: AccountValidationStatus.DISCONNECTED,
          lastValidatedAt: new Date(),
        },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          userId: auditUserId,
          action: "AWS_ACCOUNT_DISCONNECTED",
          resource: "aws_account",
          details: JSON.stringify({
            awsAccountId: account.awsAccountId,
            tenantId: account.tenantId,
            reason: error.message,
          }),
          status: "FAILED",
        },
      });
    }
  }

  console.log("Health check completed.");
  await prisma.$disconnect();
}

runHealthCheck().catch((err) => {
  console.error("Health check hit unexpected fatal error:", err);
  process.exit(1);
});
