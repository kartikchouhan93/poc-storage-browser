import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { extractIpFromRequest, validateUserIpAccess } from "@/lib/ip-whitelist";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { sendShareEmailNotification } from "@/lib/sns";
import { withTenantAccess } from "@/lib/middleware/tenant-access";

export async function POST(request: NextRequest) {
  return withTenantAccess(
    request,
    async (req, user) => {
      try {
        const clientIp = extractIpFromRequest(req);
        if (!validateUserIpAccess(clientIp, user)) {
          logAudit({
            userId: user.id,
            action: "IP_ACCESS_DENIED",
            resource: "Share",
            status: "FAILED",
            ipAddress: clientIp,
            details: { reason: "IP not whitelisted for team", method: req.method, path: req.nextUrl.pathname },
          });
          return NextResponse.json({ error: "Forbidden: IP not whitelisted for your team" }, { status: 403 });
        }

        const body = await req.json();
        const { fileId, toEmail, expiryDate: expiryDateInput, expiryDays, downloadLimit, password } = body;

        if (!fileId || !toEmail || (!expiryDateInput && !expiryDays)) {
          return NextResponse.json({ error: "fileId, toEmail, and expiryDays are required fields." }, { status: 400 });
        }

        // Compute expiry date
        let computedExpiry: Date;
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
          computedExpiry = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 23, 59, 59, 0));
        } else {
          // Backward compat: use expiryDays
          computedExpiry = new Date();
          computedExpiry.setDate(computedExpiry.getDate() + parseInt(String(expiryDays), 10));
        }

        const file = await prisma.fileObject.findUnique({ where: { id: fileId }, include: { bucket: true } });
        if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

        if (file.tenantId !== user.tenantId && user.role !== "PLATFORM_ADMIN") {
          return NextResponse.json({ error: "Forbidden: Cannot share files outside your tenant" }, { status: 403 });
        }

        let passwordHash = null;
        let passwordProtected = false;
        if (password && password.trim().length > 0) {
          passwordHash = await bcrypt.hash(password.trim(), 10);
          passwordProtected = true;
        }

        const shareLimit = parseInt(String(downloadLimit), 10) || 3;

        const share = await prisma.share.create({
          data: {
            fileId: file.id,
            tenantId: file.tenantId,
            bucketId: file.bucketId,
            toEmail: toEmail.toLowerCase().trim(),
            expiry: computedExpiry,
            downloadLimit: shareLimit,
            passwordProtected,
            passwordHash,
            createdBy: user.id,
            updatedBy: user.id,
          },
        });

        const protocol = req.headers.get("x-forwarded-proto") || "http";
        const host = req.headers.get("host") || "localhost:3000";
        const shareUrl = `${protocol}://${host}/file/share/${share.id}`;

        await sendShareEmailNotification({ toEmail: share.toEmail, shareUrl, expiryDate: share.expiry, downloadLimit: share.downloadLimit, password });

        logAudit({ userId: user.id, action: "FILE_SHARED", resource: "Share", resourceId: share.id, status: "SUCCESS", ipAddress: clientIp, details: { fileId: file.id, toEmail: share.toEmail } });

        return NextResponse.json(
          { message: "Share created successfully", share: { id: share.id, toEmail: share.toEmail, expiry: share.expiry, downloadLimit: share.downloadLimit, passwordProtected: share.passwordProtected }, shareUrl },
          { status: 201 },
        );
      } catch (error) {
        console.error("Failed to create share:", error);
        return NextResponse.json({ error: "Failed to create file share" }, { status: 500 });
      }
    },
    { allowSelfTenant: true },
  );
}

export async function GET(request: NextRequest) {
  return withTenantAccess(
    request,
    async (req, user) => {
      try {
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get("page") || "1", 10);
        const limit = parseInt(searchParams.get("limit") || "10", 10);
        const skip = (page - 1) * limit;

        const whereClause: any = {};
        if (user.role === "PLATFORM_ADMIN") {
          // no constraints
        } else if (user.role === "TENANT_ADMIN") {
          whereClause.tenantId = user.tenantId;
        } else {
          whereClause.createdBy = user.id;
        }

        const [totalCount, shares] = await Promise.all([
          prisma.share.count({ where: whereClause }),
          prisma.share.findMany({
            where: whereClause,
            include: { file: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),
        ]);

        const formattedShares = shares.map((share: any) => ({
          id: share.id,
          name: share.file.name,
          sharedWith: share.toEmail,
          expiresAt: share.expiry,
          access: share.passwordProtected ? "Protected Download" : "Download",
          status:
            share.status === "ACTIVE" && new Date() > new Date(share.expiry)
              ? "EXPIRED"
              : share.status === "ACTIVE" && share.downloads >= share.downloadLimit
                ? "EXPIRED"
                : share.status,
        }));

        return NextResponse.json({ shares: formattedShares, pagination: { totalCount, totalPages: Math.ceil(totalCount / limit), currentPage: page, limit } });
      } catch (error) {
        console.error("Failed to fetch shares:", error);
        return NextResponse.json({ error: "Failed to fetch file shares" }, { status: 500 });
      }
    },
    { allowSelfTenant: true },
  );
}
