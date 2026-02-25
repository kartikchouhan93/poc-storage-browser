'use server'

import prisma from "@/lib/prisma"
import { getCurrentUser } from "@/lib/session"
import { checkPermission } from "@/lib/rbac"

export async function getAuditLogs() {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return { success: false, error: "Unauthorized" }
        }

        // Platform admins see all, Tenant admins see their tenant's users' logs
        const whereClause = user.role === "PLATFORM_ADMIN" 
            ? {} 
            : { user: { tenantId: user.tenantId } }

        let logs = await prisma.auditLog.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 200 // Fetch more so we can filter in-memory for teammates
        })

        if (user.role === 'TEAMMATE') {
            const userWithPolicies: any = await prisma.user.findUnique({
                where: { id: user.id },
                include: { policies: true, teams: { include: { team: { include: { policies: true } } } } }
            });

            if (userWithPolicies && user.tenantId) {
                const buckets = await prisma.bucket.findMany({ where: { account: { tenantId: user.tenantId } } });
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
        
        // Trim back down to 100 after filter
        logs = logs.slice(0, 100);

        // Extract bucket IDs to fetch names
        const bucketIds = new Set<string>();
        logs.forEach((log: any) => {
            if (log.details && typeof log.details === 'object' && log.details.bucketId) {
                bucketIds.add(log.details.bucketId);
            }
        });

        const buckets = await prisma.bucket.findMany({
            where: { id: { in: Array.from(bucketIds) } },
            select: { id: true, name: true }
        });
        
        const bucketMap = new Map(buckets.map(b => [b.id, b.name]));

        const enrichedLogs = logs.map((log: any) => {
            const details = log.details || {};
            if (details.bucketId) {
                details.bucketName = bucketMap.get(details.bucketId) || "Unknown Bucket";
            }
            return {
                ...log,
                details
            };
        });

        return { success: true, data: enrichedLogs }
    } catch (error) {
        console.error("Failed to fetch audit logs:", error)
        return { success: false, error: "Failed to fetch audit logs" }
    }
}
