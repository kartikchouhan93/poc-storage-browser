import { jwtVerify, createRemoteJWKSet, createLocalJWKSet, type JWTPayload } from 'jose';

const REGION      = process.env.AWS_REGION      || 'ap-south-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'ap-south-1_LDgq3ayzF';

const jwksUrl = new URL(
  `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
);

/**
 * Remote JWKS with:
 *  - 15-minute cache so we don't hit Cognito on every request
 *  - 10-second timeout (up from the default 5s) to handle slow networks
 *  - cooldown between failed fetches to avoid hammering the endpoint
 */
const JWKS = createRemoteJWKSet(jwksUrl, {
  cacheMaxAge:          15 * 60 * 1000, // 15 min
  cooldownDuration:     30 * 1000,      // 30s between failed fetches
  timeoutDuration:      10 * 1000,      // 10s per request
});

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
    });
    return payload;
  } catch (error: any) {
    // Log the code but don't spam the console with full stack traces for
    // expected failures (expired tokens, network timeouts on dev machines)
    const code = error?.code ?? error?.name ?? 'UNKNOWN';
    if (code !== 'ERR_JWT_EXPIRED') {
      console.error('Token verification failed:', code);
    }
    return null;
  }
}

export function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
