/**
 * Returns the hub tenant (isHubTenant: true), creating it if it doesn't exist.
 * Used as the DB anchor for:
 *   - PLATFORM_ADMIN users (cross-tenant by nature)
 *   - Newly SSO-onboarded users with no tenant assignment yet
 */
import prisma from "@/lib/prisma";

let _cachedHubTenantId: string | null = null;

export async function getHubTenantId(): Promise<string> {
  if (_cachedHubTenantId) return _cachedHubTenantId;

  let hub = await prisma.tenant.findFirst({ where: { isHubTenant: true } });
  if (!hub) {
    hub = await prisma.tenant.create({
      data: { name: "Platform Hub", isHubTenant: true },
    });
  }

  _cachedHubTenantId = hub.id;
  return hub.id;
}

/** Returns true if the user is on the hub tenant but is NOT a platform admin.
 *  This means they're pending tenant assignment. */
export function isPendingAssignment(user: { tenantId: string; role: string }, hubTenantId: string): boolean {
  return user.tenantId === hubTenantId && user.role !== "PLATFORM_ADMIN";
}
