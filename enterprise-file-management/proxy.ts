import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { verifyToken } from "@/lib/token";

const BOT_JWT_SECRET = new TextEncoder().encode(
  process.env.BOT_JWT_SECRET ||
    process.env.ENCRYPTION_KEY ||
    "bot-secret-change-me",
);

async function verifyBotToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, BOT_JWT_SECRET);
    if (payload.type === "bot") return payload;
  } catch {}
  return null;
}

// Paths that don't require authentication
const publicPaths = [
  "/login",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/new-password",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/register",
  "/api/seed",
  "/api/auth/forgot-password",
  "/api/auth/confirm-password",
  "/api/auth/google",
  "/api/auth/callback",
  "/api/shares",
  "/file/share",
  "/ip-blocked",
  // Bot auth — these routes do their own token validation (EdDSA / BOT_JWT_SECRET)
  "/api/bot/verify",
  "/api/bot/refresh",
  "/api/heartbeat",
  "/api/auth/agent-sso",
  "/api/auth/token-exchange",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for Access Token in Headers (Authorization: Bearer <token>)
  const authHeader = request.headers.get("Authorization");
  let token = authHeader?.split(" ")[1];

  // Fallback to cookie
  if (!token) {
    token = request.cookies.get("accessToken")?.value;
  }

  // Redirect authenticated users away from login page
  if (pathname === "/login" && token) {
    const payload = await verifyToken(token);
    if (payload) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (!token) {
    // If it's an API route, return 401
    if (pathname.startsWith("/api")) {
      const isScan =
        pathname.includes("phpunit") ||
        pathname.includes(".php") ||
        pathname.includes("vendor");

      if (isScan) {
        console.warn(`[Middleware Scan Blocked] Path: ${pathname}`);
      } else {
        console.warn(
          `[Middleware Error] Unauthorized access to API: ${pathname}. Reason: Missing Token in Headers/Cookies.`,
        );
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // If it's a page, redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Try bot token first (HS256) — fast path, no network call
  const botPayload = await verifyBotToken(token);
  if (botPayload) {
    const requestHeaders = new Headers(request.headers);
    if (!authHeader) requestHeaders.set("Authorization", `Bearer ${token}`);
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("x-user-id", botPayload.sub as string);
    response.headers.set("x-user-role", "BOT");
    response.headers.set(
      "x-user-tenant",
      (botPayload.tenantId as string) ?? "",
    );
    return response;
  }

  const payload = await verifyToken(token);

  if (!payload) {
    if (pathname.startsWith("/api")) {
      console.warn(
        `[Middleware Error] Unauthorized access to API: ${pathname}. Reason: Invalid/Expired Token.`,
      );
      return NextResponse.json({ error: "Invalid Token" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Token is valid, proceed
  // Append the token to the request headers going to downstream APIs
  const requestHeaders = new Headers(request.headers);
  if (!authHeader && token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("x-user-id", payload.id as string);
  response.headers.set("x-user-role", payload.role as string);
  response.headers.set("x-user-tenant", payload.tenantId as string);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
