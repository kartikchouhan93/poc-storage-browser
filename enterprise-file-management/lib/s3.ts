import { S3Client } from "@aws-sdk/client-s3";
import { decrypt } from "@/lib/encryption";

interface Account {
  awsAccessKeyId?: string | null;
  awsSecretAccessKey?: string | null;
}

/**
 * Returns an S3Client using credentials in priority order:
 *  1. DB-stored credentials (decrypted)
 *  2. Env vars: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 *  3. No explicit creds → AWS SDK default credential chain
 *     (picks up ~/.aws/sso/cache, AWS_PROFILE, IMDS, etc. automatically)
 */
export function getS3Client(account: Account, region: string): S3Client {
  // 1. DB credentials
  if (account.awsAccessKeyId && account.awsSecretAccessKey) {
    return new S3Client({
      region,
      credentials: {
        accessKeyId: decrypt(account.awsAccessKeyId),
        secretAccessKey: decrypt(account.awsSecretAccessKey),
      },
    });
  }

  // 2. Env var credentials (e.g. exported before starting dev server)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    });
  }

  // 3. Fall through to AWS SDK default credential chain
  //    (handles AWS_PROFILE, ~/.aws/credentials, SSO cache, IMDS, etc.)
  return new S3Client({ region });
}
