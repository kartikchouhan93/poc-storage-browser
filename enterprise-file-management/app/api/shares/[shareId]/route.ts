import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { extractIpFromRequest } from "@/lib/ip-whitelist";
import bcrypt from "bcryptjs";

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> | { shareId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { shareId } = await params;
    const body = await request.json();
    const { expiryDate: expiryDateInput, expiryDays, downloadLimit, password } = body;

    const share = await prisma.share.findUnique({
      where: { id: shareId },
      include: { file: { select: { name: true } } },
    });

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    // Only allow creator or a tenant admin to update
    if (
      share.createdBy !== user.id &&
      user.role !== "TENANT_ADMIN" &&
      user.role !== "PLATFORM_ADMIN"
    ) {
      return NextResponse.json(
        { error: "Forbidden: You cannot modify this share" },
        { status: 403 },
      );
    }

    const updateData: any = {
      updatedBy: user.id,
      status: "ACTIVE", // Editing it might revive an expired share if we extend dates/limits
    };

    if (expiryDateInput) {
      // Validate ISO format
      const parsed = new Date(expiryDateInput);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid expiryDate format" }, { status: 400 });
      }

      // Validate it's a future date (not today or in the past)
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const inputDateUTC = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));

      if (inputDateUTC.getTime() <= todayUTC.getTime()) {
        return NextResponse.json({ error: "expiryDate must be a future date" }, { status: 400 });
      }

      // Set time to end-of-day 23:59:59 UTC
      updateData.expiry = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 23, 59, 59, 0));
    } else if (expiryDays) {
      // Backward compat: use expiryDays
      const expiryDate = new Date();
      expiryDate.setDate(
        expiryDate.getDate() + parseInt(String(expiryDays), 10),
      );
      updateData.expiry = expiryDate;
    }

    if (downloadLimit) {
      updateData.downloadLimit = parseInt(String(downloadLimit), 10);
    }

    if (password !== undefined) {
      if (password && password.trim().length > 0) {
        updateData.passwordHash = await bcrypt.hash(password.trim(), 10);
        updateData.passwordProtected = true;
      } else {
        updateData.passwordHash = null;
        updateData.passwordProtected = false;
      }
    }

    const auditDetails: any = {
      action: "update_settings",
      fileId: share.fileId,
      toEmail: share.toEmail,
      fileName: share.file.name,
      changes: {},
    };

    if (expiryDateInput)
      auditDetails.changes.expiryDate = expiryDateInput;
    else if (expiryDays)
      auditDetails.changes.extendedExpiryDays = parseInt(
        String(expiryDays),
        10,
      );
    if (downloadLimit)
      auditDetails.changes.newDownloadLimit = parseInt(
        String(downloadLimit),
        10,
      );
    if (password !== undefined) {
      if (password && password.trim().length > 0) {
        auditDetails.changes.password = "updated";
      } else {
        auditDetails.changes.password = "removed";
      }
    }

    const updatedShare = await prisma.share.update({
      where: { id: shareId },
      data: updateData,
    });

    const clientIp = extractIpFromRequest(request);

    logAudit({
      userId: user.id,
      action: "SHARE_UPDATED",
      resource: "Share",
      resourceId: share.id,
      status: "SUCCESS",
      ipAddress: clientIp,
      details: auditDetails,
    });

    return NextResponse.json({
      message: "Share updated successfully",
      share: updatedShare,
    });
  } catch (error) {
    console.error("Failed to update share:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
