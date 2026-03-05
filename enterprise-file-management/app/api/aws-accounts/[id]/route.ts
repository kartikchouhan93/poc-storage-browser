import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Role } from "@/lib/generated/prisma/client";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== Role.PLATFORM_ADMIN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Fetch the account to get tenant info for auditing and its account ID for bucket lookup
    const account = await prisma.awsAccount.findUnique({
      where: { id },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // PROTECTIVE CHECK: Check if any buckets are using this AWS account
    const dependentBuckets = await prisma.bucket.findFirst({
      where: {
        awsAccountId: account.id,
      },
    });

    if (dependentBuckets) {
      return NextResponse.json(
        {
          error:
            "Cannot delete this AWS account. There are active S3 buckets mapped to it. Please migrate or delete the buckets first.",
        },
        { status: 400 },
      );
    }

    // Safe to delete
    await prisma.awsAccount.delete({
      where: { id },
    });

    // Create audit log for deletion
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "AWS_ACCOUNT_DELETED",
        resource: "aws_account",
        details: JSON.stringify({
          awsAccountId: account.awsAccountId,
          tenantId: account.tenantId,
          region: account.region,
          friendlyName: account.friendlyName,
        }),
        status: "SUCCESS",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Account deleted successfully.",
    });
  } catch (error) {
    console.error("Failed to delete AWS account:", error);
    return NextResponse.json(
      { error: "Failed to delete AWS account" },
      { status: 500 },
    );
  }
}
