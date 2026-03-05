import prisma from "@/lib/prisma";
import { getTenantAwsCredentials } from "@/lib/aws/sts";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { AccountValidationStatus } from "@/lib/generated/prisma/client";
import { decrypt } from "@/lib/encryption";

/**
 * Validates an AWS account connection asynchronously.
 * Retries up to 3 times with exponential backoff if AssumeRole fails (to allow for IAM propagation).
 */
export async function validateAwsAccount(
  accountId: string,
  userId: string,
  retries = 3,
) {
  try {
    const account = await prisma.awsAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) return;

    let credentials;
    let attempt = 0;
    let success = false;
    const decryptedExternalId = decrypt(account.externalId);

    while (attempt < retries && !success) {
      try {
        credentials = await getTenantAwsCredentials(
          account.roleArn,
          decryptedExternalId,
        );
        success = true;
      } catch (err: any) {
        attempt++;
        console.warn(
          `[Attempt ${attempt}/${retries}] Failed to assume role for account ${accountId}: ${err.message}`,
        );
        if (attempt < retries) {
          // Exponential backoff: 10s, 20s
          await new Promise((res) => setTimeout(res, 10000 * attempt));
        }
      }
    }

    if (!success || !credentials) {
      await prisma.awsAccount.update({
        where: { id: accountId },
        data: {
          status: AccountValidationStatus.FAILED,
          lastValidatedAt: new Date(),
        },
      });
      // Audit Log: AWS Account Validation Failed
      await prisma.auditLog.create({
        data: {
          userId,
          action: "ACCOUNT_VALIDATION_FAILED",
          resource: "aws_account",
          details: JSON.stringify({
            accountId,
            awsAccountId: account.awsAccountId,
          }),
          status: "FAILED",
        },
      });
      return;
    }

    // Test global IAM read
    const stsClient = new STSClient({
      region: account.region,
      credentials,
    });
    await stsClient.send(new GetCallerIdentityCommand({}));

    await prisma.awsAccount.update({
      where: { id: accountId },
      data: {
        status: AccountValidationStatus.CONNECTED,
        lastValidatedAt: new Date(),
      },
    });

    // Audit Log: AWS Account Linked & Validated
    await prisma.auditLog.create({
      data: {
        userId,
        action: "ACCOUNT_VALIDATION_SUCCESS",
        resource: "aws_account",
        details: JSON.stringify({
          accountId,
          awsAccountId: account.awsAccountId,
        }),
        status: "SUCCESS",
      },
    });
  } catch (error: any) {
    console.error("Account validation worker error:", error);
    await prisma.awsAccount.update({
      where: { id: accountId },
      data: {
        status: AccountValidationStatus.FAILED,
        lastValidatedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        action: "ACCOUNT_VALIDATION_FAILED",
        resource: "aws_account",
        details: JSON.stringify({ accountId, error: error.message }),
        status: "FAILED",
      },
    });
  }
}
