import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { shareId: string } },
) {
  try {
    const { shareId } = params;
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
        (gp1, gp2, gp3) => {
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
