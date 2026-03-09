import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { Role } from "@/lib/generated/prisma/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== Role.PLATFORM_ADMIN && user.role !== Role.TENANT_ADMIN)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const bucket = await prisma.bucket.findUnique({
    where: { id },
    include: { awsAccount: true },
  });

  if (!bucket) return NextResponse.json({ error: "Bucket not found" }, { status: 404 });

  const ourEventBusArn = process.env.FILE_SYNC_EVENT_BUS_ARN;

  // ── Same-account bucket: configure S3 → SQS direct notification ──────────
  if (!bucket.awsAccount) {
    const fileSyncQueueArn = process.env.FILE_SYNC_QUEUE_ARN;
    if (!fileSyncQueueArn)
      return NextResponse.json({ error: "FILE_SYNC_QUEUE_ARN not configured" }, { status: 500 });

    try {
      const { getS3Client } = await import("@/lib/s3");
      const { PutBucketNotificationConfigurationCommand } = await import("@aws-sdk/client-s3");
      const s3 = await getS3Client(null, bucket.region, null);
      await s3.send(
        new PutBucketNotificationConfigurationCommand({
          Bucket: bucket.name,
          NotificationConfiguration: {
            QueueConfigurations: [
              {
                QueueArn: fileSyncQueueArn,
                Events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"],
              },
            ],
          },
        }),
      );
      return NextResponse.json({ success: true, type: "s3-sqs-direct" });
    } catch (err: any) {
      console.error("S3 notification setup failed:", err);
      return NextResponse.json({ error: err?.message || "S3 notification setup failed" }, { status: 502 });
    }
  }

  // ── BYOA bucket: configure EventBridge cross-account ─────────────────────
  if (!ourEventBusArn)
    return NextResponse.json({ error: "FILE_SYNC_EVENT_BUS_ARN not configured" }, { status: 500 });

  try {
    const { setupBucketEventBridge } = await import("@/lib/aws/setup-bucket-events");
    const result = await setupBucketEventBridge(
      {
        roleArn: bucket.awsAccount.roleArn,
        externalId: bucket.awsAccount.externalId,
        awsAccountId: bucket.awsAccount.awsAccountId,
        region: bucket.region,
      },
      bucket.name,
      ourEventBusArn,
    );

    await prisma.bucket.update({
      where: { id },
      data: { eventBridgeRuleArn: result.eventBridgeRuleArn },
    });

    return NextResponse.json({ success: true, eventBridgeRuleArn: result.eventBridgeRuleArn });
  } catch (err: any) {
    console.error("EventBridge setup failed:", err);
    return NextResponse.json({ error: err?.message || "EventBridge setup failed" }, { status: 502 });
  }
}
