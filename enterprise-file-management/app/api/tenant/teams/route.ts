import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { extractIpFromRequest } from "@/lib/ip-whitelist";
import { withTenantAccess } from "@/lib/middleware/tenant-access";

export async function GET(request: NextRequest) {
  return withTenantAccess(
    request,
    async (req, user) => {
      try {
        const teams = await prisma.team.findMany({
          where: { tenantId: user.tenantId, isDeleted: false },
          include: { _count: { select: { members: true } } },
          orderBy: { createdAt: "desc" },
        });
        return NextResponse.json(teams);
      } catch (error) {
        console.error("Fetch teams error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
      }
    },
    { allowSelfTenant: true },
  );
}

export async function POST(request: NextRequest) {
  return withTenantAccess(
    request,
    async (req, user) => {
      try {
        if (user.role !== "TENANT_ADMIN") {
          return NextResponse.json({ error: "Unauthorized or insufficient permissions" }, { status: 401 });
        }

        const { name, allowedIps } = await req.json();
        if (!name?.trim()) {
          return NextResponse.json({ error: "Team name is required" }, { status: 400 });
        }

        const team = await prisma.team.create({
          data: {
            name: name.trim(),
            tenantId: user.tenantId,
            allowedIps: allowedIps ? allowedIps.trim() : null,
          },
          include: { _count: { select: { members: true } } },
        });

        logAudit({
          userId: user.id,
          action: "TEAM_CREATED",
          resource: "Team",
          resourceId: team.id,
          status: "SUCCESS",
          ipAddress: extractIpFromRequest(req),
          details: { name: team.name, tenantId: user.tenantId },
        });

        return NextResponse.json(team);
      } catch (error) {
        console.error("Create team error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
      }
    },
    { allowSelfTenant: true },
  );
}
