import { NextRequest, NextResponse } from "next/server";
import { jwtDecode } from "jwt-decode";
import prisma from "@/lib/prisma";
import { authenticateCognitoUser } from "@/lib/auth-service";
import { logAudit } from "@/lib/audit";
import { extractIpFromRequest, validateUserIpAccess } from "@/lib/ip-whitelist";
import { getHubTenantId } from "@/lib/hub-tenant";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Missing email or password" },
        { status: 400 },
      );
    }

    let authResult;
    let initiateAuthResponse;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    try {
      initiateAuthResponse = await authenticateCognitoUser(
        cleanEmail,
        cleanPassword,
      );
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || "Invalid credentials" },
        { status: 401 },
      );
    }

    if (initiateAuthResponse.ChallengeName === "NEW_PASSWORD_REQUIRED") {
      return NextResponse.json(
        {
          challengeName: "NEW_PASSWORD_REQUIRED",
          session: initiateAuthResponse.Session,
          message: "A new password is required",
        },
        { status: 200 },
      ); // Return 200 so frontend can handle challenge
    }

    authResult = initiateAuthResponse.AuthenticationResult;

    if (!authResult || !authResult.IdToken) {
      return NextResponse.json(
        { error: "Invalid response from Cognito" },
        { status: 500 },
      );
    }

    const defaultRole =
      cleanEmail.toLowerCase() === "admin@fms.com"
        ? "PLATFORM_ADMIN"
        : "TEAMMATE";

    let user: any;
    try {
      // Decode IdToken to extract tenantId from Cognito custom claims
      const decoded = jwtDecode<Record<string, string>>(authResult.IdToken!);
      const tokenTenantId = decoded["custom:tenantId"] || null;

      // Platform admin and unassigned users anchor to the hub tenant
      const isPlatformAdmin = defaultRole === "PLATFORM_ADMIN";
      const resolvedTenantId =
        tokenTenantId ??
        (isPlatformAdmin || !tokenTenantId ? await getHubTenantId() : null);

      if (!resolvedTenantId) {
        console.error("Login: could not resolve tenantId for", cleanEmail);
        return NextResponse.json(
          {
            error:
              "Tenant assignment missing. Please contact your administrator.",
          },
          { status: 401 },
        );
      }

      // Verify tenant exists locally before proceeding
      const tenantExists = await prisma.tenant.findUnique({
        where: { id: resolvedTenantId },
      });

      if (!tenantExists) {
        console.error(
          `Login: resolved tenantId ${resolvedTenantId} does not exist in local DB for ${cleanEmail}`,
        );
        return NextResponse.json(
          {
            error:
              "Authorized tenant not found in local system. Please contact support.",
          },
          { status: 401 },
        );
      }

      // Find existing user — scope by tenantId
      let existingUser = await prisma.user.findFirst({
        where: { email: cleanEmail, tenantId: resolvedTenantId },
      });

      if (existingUser) {
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: { hasLoggedIn: true },
          include: {
            policies: true,
            teams: { include: { team: { include: { policies: true } } } },
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: cleanEmail,
            role: defaultRole as any,
            tenantId: resolvedTenantId,
            hasLoggedIn: true,
          },
          include: {
            policies: true,
            teams: { include: { team: { include: { policies: true } } } },
          },
        });
      }
    } catch (prismaErr) {
      console.error("Local user sync err:", prismaErr);
      return NextResponse.json(
        {
          error: "Failed to synchronize local user account. Please try again.",
        },
        { status: 500 },
      );
    }

    if (user && !user.isActive) {
      logAudit({
        userId: user.id,
        action: "LOGIN",
        resource: "Authentication",
        status: "FAILED",
        ipAddress: extractIpFromRequest(request),
        details: {
          reason: "User account is inactive",
          email: cleanEmail,
        },
      });
      return NextResponse.json(
        {
          error: "Your account is inactive. Please contact your administrator.",
        },
        { status: 403 },
      );
    }

    if (user) {
      const clientIp = extractIpFromRequest(request);
      if (!validateUserIpAccess(clientIp, user)) {
        logAudit({
          userId: user.id,
          action: "IP_ACCESS_DENIED",
          resource: "Authentication",
          status: "FAILED",
          ipAddress: clientIp,
          details: {
            reason: "IP not whitelisted for team during login",
            method: "PASSWORD",
          },
        });
        return NextResponse.json({ error: "IP_BLOCKED" }, { status: 403 });
      }
    }

    const hubTenantId = await getHubTenantId();
    const isPendingAssignment = user
      ? user.tenantId === hubTenantId && user.role !== "PLATFORM_ADMIN"
      : false;

    const responseBody = {
      message: "Login successful",
      role: user?.role || defaultRole,
      tenantId: user?.tenantId || "",
      name: user?.name || "",
      id: user?.id || "",
      accessToken: authResult.IdToken,
      policies: user?.policies || [],
      teams: user?.teams || [],
      pendingAssignment: isPendingAssignment,
    };
    const response = NextResponse.json(responseBody);

    response.cookies.set({
      name: "accessToken",
      value: authResult.IdToken || "",
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60,
    });

    if (authResult.RefreshToken) {
      response.cookies.set({
        name: "refreshToken",
        value: authResult.RefreshToken,
        httpOnly: true,
        secure: false,
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    if (user) {
      logAudit({
        userId: user.id,
        action: "LOGIN",
        resource: "Authentication",
        status: "SUCCESS",
        ipAddress: extractIpFromRequest(request),
        details: { email: cleanEmail, role: user.role },
      });
    }

    return response;
  } catch (error) {
    console.error("Login Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
