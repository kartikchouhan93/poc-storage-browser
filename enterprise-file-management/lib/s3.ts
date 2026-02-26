import { S3Client } from "@aws-sdk/client-s3";
import { decrypt } from "@/lib/encryption";

interface Account {
  awsAccessKeyId?: string | null;
  awsSecretAccessKey?: string | null;
}

const s3ClientCache = new Map<string, S3Client>();

/**
 * Returns an S3Client using credentials in priority order:
 *  1. DB-stored credentials (decrypted)
 *  2. Env vars: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 *  3. No explicit creds → AWS SDK default credential chain
 *     (picks up ~/.aws/sso/cache, AWS_PROFILE, IMDS, etc. automatically)
 *  Note: S3Client instances are cached to prevent connection exhaustion
 *        and EAI_AGAIN (DNS) errors during large multipart uploads.
 */
export function getS3Client(account: Account, region: string): S3Client {
  // 1. DB credentials
  if (account.awsAccessKeyId && account.awsSecretAccessKey) {
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
