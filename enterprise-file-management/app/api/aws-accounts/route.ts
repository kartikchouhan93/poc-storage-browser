import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Role } from "@/lib/generated/prisma/client";
import { encrypt } from "@/lib/encryption";
import { validateAwsAccount } from "@/lib/workers/account-validator";
import { withTenantAccess } from "@/lib/middleware/tenant-access";

// Create new tenant AWS account links (starts process and triggers async validation)
export async function POST(request: NextRequest) {
  return withTenantAccess(
    request,
    async (req, user) => {
      try {
        if (user.role !== Role.PLATFORM_ADMIN) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { tenantId, awsAccountId, region, roleArn, externalId, friendlyName, description } = body;

        if (!tenantId || !awsAccountId || !region || !roleArn || !externalId || !friendlyName) {
          return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const existingAccount = await prisma.awsAccount.findFirst({
          where: { tenantId, status: { in: ["CONNECTED", "CREATING", "PENDING_VALIDATION"] } },
        });
        if (existingAccount) {
          return NextResponse.json({ error: "Tenant already has an active AWS Account. Please delete it first." }, { status: 400 });
        }

        const duplicateAwsAccount = await prisma.awsAccount.findFirst({ where: { awsAccountId } });
        if (duplicateAwsAccount) {
          return NextResponse.json({ error: `AWS Account ID ${awsAccountId} is already linked to another tenant.` }, { status: 409 });
        }

        const encryptedExternalId = encrypt(externalId);
        const account = await prisma.awsAccount.create({
          data: { tenantId, awsAccountId, region, roleArn, externalId: encryptedExternalId, friendlyName, description, status: "CREATING" },
        });

        validateAwsAccount(account.id, user.id).catch((err) => {
          console.error("Validation worker failed:", err);
        });

        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: "AWS_ACCOUNT_INTEGRATED",
            resource: "aws_account",
            details: JSON.stringify({ awsAccountId, tenantId, region, friendlyName }),
            status: "SUCCESS",
          },
        });

        return NextResponse.json({ success: true, data: account });
      } catch (error) {
        console.error("Failed to create AWS account:", error);
        return NextResponse.json({ error: "Failed to create AWS account" }, { status: 500 });
      }
    },
    // tenantId comes from body — standard extraction handles it
  );
}
