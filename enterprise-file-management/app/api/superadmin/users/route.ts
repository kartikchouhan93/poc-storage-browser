import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { inviteUserToCognito } from "@/lib/auth-service";
import { getCurrentUser } from "@/lib/session";
import { getHubTenantId } from "@/lib/hub-tenant";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "PLATFORM_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const users = await prisma.user.findMany({
    where: {
      tenant: {
        isHubTenant: false,
      },
    },
    include: {
      tenant: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "PLATFORM_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { email, role, name, tenantId } = await request.json();

    const finalTenantId = tenantId || (await getHubTenantId());

    // Invite to Cognito explicitly
    await inviteUserToCognito(email, finalTenantId, role || "TEAMMATE", name);

    // Log in Postgres
    const newUser = await prisma.user.create({
      data: {
        email,
        name,
        role: role || "TEAMMATE",
        tenantId: finalTenantId,
      },
    });

    return NextResponse.json(newUser);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
