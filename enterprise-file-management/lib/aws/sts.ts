import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

interface CachedCredential {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

// In-memory cache: Maps RoleArn to a CachedCredential
const credentialCache = new Map<string, CachedCredential>();

// We refresh the token if it expires in less than 5 minutes
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Assumes a cross-account role and returns temporary credentials.
 * Utilizes an in-memory cache to prevent excessive STS AssumeRole calls.
 * Implements token rotation logic.
 */
export async function getTenantAwsCredentials(
  roleArn: string,
  externalId: string,
  sessionName = "CamsPlatformSession",
) {
  const cached = credentialCache.get(roleArn);

  // If we have a valid cached token that isn't expiring soon, use it
  if (cached && cached.expiration.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return {
      accessKeyId: cached.accessKeyId,
      secretAccessKey: cached.secretAccessKey,
      sessionToken: cached.sessionToken,
    };
  }

  try {
    // Fallback to us-east-1 for global STS AssumeRole
    // Include retry backoff for rate limiting
    const stsConfig: any = {
      region: "us-east-1",
      maxAttempts: 5,
    };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      stsConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    }

    const stsClient = new STSClient(stsConfig);

    const command = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      ExternalId: externalId,
      DurationSeconds: 3600, // 1 hour max duration typically
    });

    const response = await stsClient.send(command);

    if (!response.Credentials) {
      throw new Error("AssumeRole succeeded but no credentials were returned.");
    }

    const newCredentials = {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken!,
      expiration: response.Credentials.Expiration!,
    };

    // Update cache
    credentialCache.set(roleArn, newCredentials);

    return {
      accessKeyId: newCredentials.accessKeyId,
      secretAccessKey: newCredentials.secretAccessKey,
      sessionToken: newCredentials.sessionToken,
    };
  } catch (error) {
    console.error(`Failed to assume role ${roleArn}:`, error);
    throw error;
  }
}
