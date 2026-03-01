import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { extractIpFromRequest } from "@/lib/ip-whitelist";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  try {
    const { teamId } = await params;
    const user = await getCurrentUser();
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const team = await prisma.team.findFirst({
      where: {
        id: teamId,
        tenantId: user.tenantId,
        isDeleted: false,
      },
      include: {
        members: {
          where: { isDeleted: false },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
              },
            },
          },
        },
        policies: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    return NextResponse.json(team);
  } catch (error) {
    console.error("Fetch team error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  try {
    const { teamId } = await params;
    const user = await getCurrentUser();
    if (!user || user.role !== "TENANT_ADMIN" || !user.tenantId) {
      return NextResponse.json(
        { error: "Unauthorized or insufficient permissions" },
        { status: 401 },
      );
    }

    const { name, allowedIps } = await request.json();

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (allowedIps !== undefined)
      updateData.allowedIps = allowedIps ? allowedIps.trim() : null;

    const team = await prisma.team.update({
      where: { id: teamId, tenantId: user.tenantId },
      data: updateData,
    });

    logAudit({
      userId: user.id,
      action: "TEAM_UPDATED",
      resource: "Team",
      resourceId: team.id,
      status: "SUCCESS",
      ipAddress: extractIpFromRequest(request),
      details: { tenantId: user.tenantId, allowedIps },
    });

    return NextResponse.json(team);
  } catch (error) {
    console.error("Update team error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  try {
    const { teamId } = await params;
    const user = await getCurrentUser();
    if (!user || user.role !== "TENANT_ADMIN" || !user.tenantId) {
      return NextResponse.json(
        { error: "Unauthorized or insufficient permissions" },
        { status: 401 },
      );
    }

    // Soft delete all memberships
    await prisma.teamMembership.updateMany({
      where: { teamId },
      data: { isDeleted: true },
    });

    // Soft delete the team itself
    await prisma.team.update({
      where: {
        id: teamId,
      },
      data: { isDeleted: true },
    });

    logAudit({
      userId: user.id,
      action: "TEAM_DELETED",
      resource: "Team",
      resourceId: teamId,
      status: "SUCCESS",
      ipAddress: extractIpFromRequest(request),
      details: { tenantId: user.tenantId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete team error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
