import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyToken } from "@/lib/token";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { decrypt } from "@/lib/encryption";
import { checkPermission } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("Authorization")?.split(" ")[1];
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || typeof payload !== "object" || !payload.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: payload.email as string },
      include: { policies: true },
    });

    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const searchParams = request.nextUrl.searchParams;
    const bucketId = searchParams.get("bucketId");
    const action = searchParams.get("action"); // 'upload' or 'download'
    const parentId = searchParams.get("parentId");
    const contentType =
      searchParams.get("contentType") ?? "application/octet-stream";
    const name = searchParams.get("name");
    const paramKey = searchParams.get("key");

    // Verify Bucket Access
    if (!bucketId)
      return NextResponse.json(
        { error: "Bucket ID required" },
        { status: 400 },
      );

    const bucket = await prisma.bucket.findUnique({
      where: { id: bucketId },
      include: { account: true },
    });

    if (!bucket)
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });

    // Determine required permission based on action
    const requiredPermission = action === "download" ? "READ" : "WRITE";

    // Check Permission
    const hasAccess = await checkPermission(user, requiredPermission, {
      tenantId: bucket.account.tenantId,
      resourceType: "bucket",
      resourceId: bucket.id,
    });

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const account = bucket.account;
    if (!account.awsAccessKeyId || !account.awsSecretAccessKey) {
      return NextResponse.json(
        { error: "AWS credentials missing for this account" },
        { status: 422 },
      );
    }

    // Determine Key
    let key: string = paramKey || (name as string);
    if (!paramKey && parentId && parentId !== "null") {
      const parent = await prisma.fileObject.findUnique({
        where: { id: parentId },
      });
      if (parent) {
        // Ensure parent key doesn't have double slashes if it ends with /
        const prefix = parent.key.endsWith("/") ? parent.key : `${parent.key}/`;
        key = `${prefix}${name}`;
      }
    }

    const s3 = new S3Client({
      region: bucket.region,
      credentials: {
        accessKeyId: decrypt(account.awsAccessKeyId!),
        secretAccessKey: decrypt(account.awsSecretAccessKey!),
      },
    });

    let command;
    if (action === "download" || action === "read") {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      command = new GetObjectCommand({
        Bucket: bucket.name,
        Key: key,
        ResponseContentDisposition:
          action === "read"
            ? "inline"
            : `attachment; filename="${name || key.split("/").pop()}"`,
      });
    } else {
      // Default to Upload (PutObject)
      command = new PutObjectCommand({
        Bucket: bucket.name,
        Key: key,
        ContentType: contentType,
      });
    }

    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return NextResponse.json({ url, key });
  } catch (error) {
    console.error("Presigned URL error:", error);
    return NextResponse.json(
      { error: "Failed to generate presigned URL" },
      { status: 500 },
    );
  }
}
