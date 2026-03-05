import { S3Client } from "@aws-sdk/client-s3";
import { decrypt } from "@/lib/encryption";
import { getTenantAwsCredentials } from "@/lib/aws/sts";

interface Account {
  awsAccessKeyId?: string | null;
  awsSecretAccessKey?: string | null;
}

interface AwsAccount {
  roleArn: string;
  externalId: string;
}

const s3ClientCache = new Map<string, S3Client>();

/**
 * Returns an S3Client using credentials in priority order:
 *  0. Cross-Account STS AssumeRole (if awsAccount provided)
 *  1. DB-stored static credentials (decrypted)
 *  2. Env vars: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 *  3. No explicit creds → AWS SDK default credential chain
 *     (picks up ECS/Fargate Task Role, AWS_PROFILE, IMDS, etc.)
 */
export async function getS3Client(
  account: Account | null,
  region: string,
  awsAccount?: AwsAccount | null,
): Promise<S3Client> {
  // 0. Cross-Account / BYOA STS AssumeRole
  if (awsAccount?.roleArn && awsAccount?.externalId) {
    const cacheKey = `sts-${awsAccount.roleArn}-${region}`;
    if (s3ClientCache.has(cacheKey)) {
      return s3ClientCache.get(cacheKey)!;
    }

    try {
      const decryptedExternalId = decrypt(awsAccount.externalId);
      const creds = await getTenantAwsCredentials(
        awsAccount.roleArn,
        decryptedExternalId,
      );

      const client = new S3Client({
        region,
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
        },
        maxAttempts: 3,
      });
      s3ClientCache.set(cacheKey, client);
      return client;
    } catch (error) {
      console.error("Failed to assume cross-account role for S3 client", error);
      throw new Error("Could not construct STS-backed S3 Client");
    }
  }

  // 1. DB static credentials
  if (account?.awsAccessKeyId && account?.awsSecretAccessKey) {
    const cacheKey = `account-${account.awsAccessKeyId}-${region}`;
    if (s3ClientCache.has(cacheKey)) {
      return s3ClientCache.get(cacheKey)!;
    }
    const client = new S3Client({
      region,
      credentials: {
        accessKeyId: decrypt(account.awsAccessKeyId),
        secretAccessKey: decrypt(account.awsSecretAccessKey),
      },
      maxAttempts: 3,
    });
    s3ClientCache.set(cacheKey, client);
    return client;
  }

  // 2. Env var credentials (e.g. exported before starting dev server)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const cacheKey = `env-${region}`;
    if (s3ClientCache.has(cacheKey)) {
      return s3ClientCache.get(cacheKey)!;
    }
    const client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
      maxAttempts: 3,
    });
    s3ClientCache.set(cacheKey, client);
    return client;
  }

  // 3. Fall through to AWS SDK default credential chain
  //    (handles AWS_PROFILE, ~/.aws/credentials, SSO cache, IMDS, etc.)
  const cacheKey = `default-${region}`;
  if (s3ClientCache.has(cacheKey)) {
    return s3ClientCache.get(cacheKey)!;
  }
  const client = new S3Client({
    region,
    maxAttempts: 3,
  });
  s3ClientCache.set(cacheKey, client);
  return client;
}
