import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Role } from "@/lib/generated/prisma/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.PLATFORM_ADMIN)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;
  const body = await request.json();
  const { role } = body as { role: Role };

  if (!role || !Object.values(Role).includes(role))
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role },
  });

  return NextResponse.json({ userId: updated.id, role: updated.role });
}
