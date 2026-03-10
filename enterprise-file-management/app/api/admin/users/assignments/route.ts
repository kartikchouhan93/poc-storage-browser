import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Role } from "@/lib/generated/prisma/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.PLATFORM_ADMIN)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const email = request.nextUrl.searchParams.get("email");
  if (!email)
    return NextResponse.json({ error: "email query param is required" }, { status: 400 });

  const rows = await prisma.user.findMany({
    where: { email: email.toLowerCase() },
    include: { tenant: true },
  });

  const assignments = rows.map((r) => ({
    userId: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenant?.name ?? null,
    role: r.role,
    email: r.email,
    name: r.name,
    isActive: r.isActive,
  }));

  return NextResponse.json(assignments);
}
