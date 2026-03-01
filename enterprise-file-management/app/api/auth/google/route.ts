import { NextResponse } from "next/server";

export async function GET() {
  const domainPrefix = process.env.COGNITO_DOMAIN_PREFIX; // e.g., 'my-app'
  const customDomain = process.env.COGNITO_DOMAIN; // e.g., 'auth.my-app.com'
  const region = process.env.AWS_REGION || "ap-south-1";
  const clientId = process.env.COGNITO_CLIENT_ID;

  let domainUrl = customDomain ? `https://${customDomain}` : null;
  if (!domainUrl && domainPrefix) {
    domainUrl = `https://${domainPrefix}.auth.${region}.amazoncognito.com`;
  }

  if (!domainUrl) {
    return new NextResponse(
      "Cognito Domain is not configured. Please set COGNITO_DOMAIN or COGNITO_DOMAIN_PREFIX in your environment variables to enable Google SSO.",
      { status: 500 },
    );
  }

  const redirectUri = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
    : "http://localhost:3000/api/auth/callback";

  const authUrl = `${domainUrl}/oauth2/authorize?identity_provider=Google&response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=email+openid+profile`;

  return NextResponse.redirect(authUrl);
}
