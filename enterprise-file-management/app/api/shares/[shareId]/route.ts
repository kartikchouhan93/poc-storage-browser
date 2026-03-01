import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { extractIpFromRequest } from "@/lib/ip-whitelist";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> | { shareId: string } },
) {
  try {
    const { shareId } = await params;
    const share = await prisma.share.findUnique({
      where: { id: shareId },
      include: { file: { select: { name: true, size: true, mimeType: true } } },
    });

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    if (share.status === "REVOKED") {
      return NextResponse.json(
        { error: "Share link has been revoked" },
        { status: 403 },
      );
    }

    if (new Date() > new Date(share.expiry)) {
      // Mark as expired in the background
      prisma.share
        .update({ where: { id: share.id }, data: { status: "EXPIRED" } })
        .catch(() => {});
      return NextResponse.json(
        { error: "Share link has expired" },
        { status: 403 },
      );
    }

    if (share.downloads >= share.downloadLimit) {
      prisma.share
        .update({ where: { id: share.id }, data: { status: "EXPIRED" } })
        .catch(() => {});
      return NextResponse.json(
        { error: "Download limit reached" },
        { status: 403 },
      );
    }

    // Public metadata
    return NextResponse.json({
      id: share.id,
      fileName: share.file.name,
      fileSize: share.file.size ? Number(share.file.size) : 0,
      mimeType: share.file.mimeType,
      requiresPassword: share.passwordProtected,
      expiresAt: share.expiry,
      // Masking email for security (e.g. sa***@example.com)
      toEmailMasked: share.toEmail.replace(
        /(.{2})(.*)(?=@)/,
        (_match: string, gp1: string, gp2: string, gp3: string) => {
          return gp2 + gp3.replace(/./g, "*");
        },
      ),
    });
  } catch (error) {
    console.error("Failed to fetch share:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> | { shareId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { shareId } = await params;
    const share = await prisma.share.findUnique({
      where: { id: shareId },
    });

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    // Only allow creator or a tenant admin to revoke
    if (
      share.createdBy !== user.id &&
      user.role !== "TENANT_ADMIN" &&
      user.role !== "PLATFORM_ADMIN"
    ) {
      return NextResponse.json(
        { error: "Forbidden: You cannot revoke this share" },
        { status: 403 },
      );
    }

    const updatedShare = await prisma.share.update({
      where: { id: shareId },
      data: { status: "REVOKED", updatedBy: user.id },
    });

    const clientIp = extractIpFromRequest(request);

    logAudit({
      userId: user.id,
      action: "SHARE_REVOKED",
      resource: "Share",
      resourceId: share.id,
      status: "SUCCESS",
      ipAddress: clientIp,
      details: { fileId: share.fileId, toEmail: share.toEmail },
    });

    return NextResponse.json({
      message: "Share revoked successfully",
      share: updatedShare,
    });
  } catch (error) {
    console.error("Failed to revoke share:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
