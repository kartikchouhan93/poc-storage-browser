"use server";

import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { checkPermission } from "@/lib/rbac";
import { Role } from "@/lib/generated/prisma/client";

export async function getAuditLogs(filters?: {
  action?: string;
  timeRange?: string;
}) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    // Platform admins see all, Tenant admins see their tenant's users' logs
    const whereClause =
      user.role === "PLATFORM_ADMIN"
        ? {}
        : { user: { tenantId: user.tenantId } };

    let logs = await prisma.auditLog.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 200, // Fetch more so we can filter in-memory for teammates
    });

    if (user.role === "TEAMMATE") {
      const userWithPolicies: any = await prisma.user.findUnique({
        where: { id: user.id },
        include: {
          policies: true,
          teams: { include: { team: { include: { policies: true } } } },
        },
      });

      if (userWithPolicies && user.tenantId) {
        const buckets = await prisma.bucket.findMany({
          where: { account: { tenantId: user.tenantId } },
        });
        const allowedBucketIds = new Set<string>();
        for (const b of buckets) {
          const hasAccess = await checkPermission(userWithPolicies, "READ", {
            tenantId: user.tenantId!,
            resourceType: "bucket",
            resourceId: b.id,
          });
          if (hasAccess) allowedBucketIds.add(b.id);
        }

        logs = logs.filter((log: any) => {
          const details = log.details as any;
          if (details && details.bucketId) {
            return allowedBucketIds.has(details.bucketId);
          }
          if (log.action === "LOGIN" || log.action === "LOGOUT") {
            return log.userId === user.id;
          }
          return false;
        });
      }
    }

    // Apply filters
    if (filters?.action && filters.action !== "all") {
      logs = logs.filter((log: any) => {
        const action = log.action.toLowerCase();
        const filterVal = filters.action!;
        if (filterVal === "upload") return action.includes("upload");
        if (filterVal === "download") return action.includes("download");
        if (filterVal === "delete")
          return action.includes("delete") || action.includes("remove");
        if (filterVal === "share")
          return action.includes("share") || action.includes("permission");
        if (filterVal === "create_bucket") return action.includes("create");
        if (filterVal === "invite_user")
          return action.includes("team") || action.includes("login");
        if (filterVal === "modify") return action.includes("modify");
        if (filterVal === "sync") return action.includes("sync");
        if (filterVal === "view") return action.includes("view");
        return true;
      });
    }

    if (filters?.timeRange && filters.timeRange !== "all") {
      const now = new Date();
      let threshold = new Date();
      if (filters.timeRange === "7d") threshold.setDate(now.getDate() - 7);
      else if (filters.timeRange === "30d")
        threshold.setDate(now.getDate() - 30);
      else if (filters.timeRange === "90d")
        threshold.setDate(now.getDate() - 90);

      logs = logs.filter((log: any) => new Date(log.createdAt) >= threshold);
    }

    // Trim back down to 100 after filter
    logs = logs.slice(0, 100);

    // Extract bucket IDs to fetch names
    const bucketIds = new Set<string>();
    logs.forEach((log: any) => {
      if (
        log.details &&
        typeof log.details === "object" &&
        log.details.bucketId
      ) {
        bucketIds.add(log.details.bucketId);
      }
    });

    const buckets = await prisma.bucket.findMany({
      where: { id: { in: Array.from(bucketIds) } },
      select: { id: true, name: true },
    });

    const bucketMap = new Map(buckets.map((b) => [b.id, b.name]));

    const enrichedLogs = logs.map((log: any) => {
      const details = log.details || {};
      if (details.bucketId) {
        details.bucketName =
          bucketMap.get(details.bucketId) || "Unknown Bucket";
      }
      return {
        ...log,
        details,
      };
    });

    return { success: true, data: enrichedLogs };
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    return { success: false, error: "Failed to fetch audit logs" };
  }
}

// ─── S3 cost rate ────────────────────────────────────────────────────────────
const COST_PER_GB = 0.023; // $0.023 per GB/month (standard S3 rate)

// Helper: resolve which bucket IDs the user is allowed to see
async function getAllowedBucketIds(user: any): Promise<string[] | null> {
  // null means "all buckets" (admin shortcut)
  if (user.role === Role.PLATFORM_ADMIN) return null;

  if (user.role === Role.TENANT_ADMIN) {
    const tenantBuckets = await prisma.bucket.findMany({
      where: { account: { tenantId: user.tenantId } },
      select: { id: true },
    });
    return tenantBuckets.map((b) => b.id);
  }

  // TEAMMATE — check policies from direct assignments + team memberships
  const allPolicies: any[] = [
    ...(user.policies || []),
    ...(user.teams || []).flatMap(
      (membership: any) => membership.team?.policies || [],
    ),
  ];

  const hasGlobalAccess = allPolicies.some(
    (p: any) =>
      p.resourceType?.toLowerCase() === "bucket" &&
      p.resourceId === null &&
      (p.actions.includes("READ") || p.actions.includes("LIST")),
  );

  if (hasGlobalAccess) {
    // Wildcard access — return all tenant buckets
    const tenantBuckets = await prisma.bucket.findMany({
      where: { account: { tenantId: user.tenantId } },
      select: { id: true },
    });
    return tenantBuckets.map((b) => b.id);
  }

  const allowedIds = [
    ...new Set(
      allPolicies
        .filter(
          (p: any) =>
            p.resourceType?.toLowerCase() === "bucket" &&
            p.resourceId !== null &&
            (p.actions.includes("READ") || p.actions.includes("LIST")),
        )
        .map((p: any) => p.resourceId as string),
    ),
  ];

  return allowedIds;
}

export interface DashboardStats {
  totalFiles: number;
  totalStorageBytes: number;
  activeBuckets: number;
  monthlyCostUsd: number;
  storageByBucket: { name: string; sizeGb: number }[];
  costTrend: { month: string; total: number }[];
}

export async function getDashboardStats(): Promise<
  { success: true; data: DashboardStats } | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const allowedBucketIds = await getAllowedBucketIds(user);

    // Build Prisma where clause for FileObject queries
    const fileWhere: any = { isFolder: false };
    if (allowedBucketIds !== null) {
      fileWhere.bucketId = { in: allowedBucketIds };
    }

    // ── 1. Aggregate totals ──────────────────────────────────────────────────
    const [fileAgg, bucketCount] = await Promise.all([
      prisma.fileObject.aggregate({
        where: fileWhere,
        _count: { id: true },
        _sum: { size: true },
      }),
      prisma.bucket.count(
        allowedBucketIds !== null
          ? { where: { id: { in: allowedBucketIds } } }
          : undefined,
      ),
    ]);

    const totalFiles = fileAgg._count.id;
    const totalStorageBytes = Number(fileAgg._sum.size ?? 0);
    const totalStorageGb = totalStorageBytes / 1_073_741_824; // bytes → GiB
    const monthlyCostUsd = parseFloat(
      (totalStorageGb * COST_PER_GB).toFixed(2),
    );

    // ── 2. Storage by bucket ─────────────────────────────────────────────────
    const bucketIds =
      allowedBucketIds ??
      (await prisma.bucket.findMany({ select: { id: true } })).map((b) => b.id);

    const bucketRows = await prisma.bucket.findMany({
      where: { id: { in: bucketIds } },
      select: { id: true, name: true },
    });

    const storageByBucketRaw = await Promise.all(
      bucketRows.map(async (b) => {
        const agg = await prisma.fileObject.aggregate({
          where: { bucketId: b.id, isFolder: false },
          _sum: { size: true },
        });
        return {
          name: b.name,
          sizeGb: parseFloat(
            (Number(agg._sum.size ?? 0) / 1_073_741_824).toFixed(3),
          ),
        };
      }),
    );

    // Sort descending by size
    const storageByBucket = storageByBucketRaw.sort(
      (a, b) => b.sizeGb - a.sizeGb,
    );

    // ── 3. Cost trend (last 6 months) ────────────────────────────────────────
    // Build month boundaries for the last 6 calendar months
    const now = new Date();
    const months: { label: string; start: Date; end: Date }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const label = d.toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      });
      months.push({ label, start, end });
    }

    // For each month, sum storage added up to the END of that month as a
    // running-total proxy (i.e., cumulative storage growth → cost estimate)
    const costTrend = await Promise.all(
      months.map(async ({ label, end }) => {
        const agg = await prisma.fileObject.aggregate({
          where: {
            ...(allowedBucketIds !== null
              ? { bucketId: { in: allowedBucketIds } }
              : {}),
            isFolder: false,
            createdAt: { lt: end },
          },
          _sum: { size: true },
        });
        const gb = Number(agg._sum.size ?? 0) / 1_073_741_824;
        return {
          month: label,
          total: parseFloat((gb * COST_PER_GB).toFixed(2)),
        };
      }),
    );

    return {
      success: true,
      data: {
        totalFiles,
        totalStorageBytes,
        activeBuckets: bucketCount,
        monthlyCostUsd,
        storageByBucket,
        costTrend,
      },
    };
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    return { success: false, error: "Failed to fetch dashboard stats" };
  }
}
