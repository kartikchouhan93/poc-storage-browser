"use server";

import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { Role } from "@/lib/generated/prisma/client";
import { createUserWithPasswordInCognito } from "@/lib/auth-service";
import { logAudit } from "@/lib/audit";
import { deleteTenantWorker } from "@/lib/workers/tenant-deleter";
import { getCurrentUser } from "@/lib/session";
import { extractIpFromHeaders } from "@/lib/ip-whitelist";

export async function getTenants() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, error: "Unauthorized" };
  }

  const where: any = { isHubTenant: false };
  if (currentUser.role !== "PLATFORM_ADMIN") {
    // If not platform admin, they can ONLY see their own tenant
    where.id = currentUser.tenantId;
  }

  try {
    const tenants = await prisma.tenant.findMany({
      where,
      include: {
        _count: {
          select: { users: true },
        },
        awsAccounts: {
          select: { id: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Calculate storage usage (mock logic or separate aggregation needed for real large datasets)
    // For this POC, we'll fetch file sizes related to the tenant's buckets
    // We explicitly type 'tenant' as any for now to avoid deep type matching issues with the include
    const tenantsWithStorage = await Promise.all(
      tenants.map(async (tenant: any) => {
        const accounts = await prisma.awsAccount.findMany({
          where: { tenantId: tenant.id },
          select: {
            buckets: {
              select: {
                objects: {
                  select: { size: true },
                },
              },
            },
          },
        });

        let totalSize = 0;
        accounts.forEach((account: any) => {
          account.buckets.forEach((bucket: any) => {
            bucket.objects.forEach((obj: any) => {
              totalSize += Number(obj.size || 0);
            });
          });
        });

        return {
          ...tenant,
          storageUsed: totalSize,
        };
      }),
    );

    return { success: true, data: tenantsWithStorage };
  } catch (error) {
    console.error("Failed to fetch tenants:", error);
    return { success: false, error: "Failed to fetch tenants" };
  }
}

export async function createTenant(formData: FormData) {
  const name = formData.get("name") as string;
  const adminName = formData.get("adminName") as string;
  const adminEmail = (formData.get("adminEmail") as string).toLowerCase();
  const adminPassword = formData.get("adminPassword") as string;

  if (!name || !adminName || !adminEmail || !adminPassword) {
    return { success: false, error: "Missing required fields" };
  }

  const currentUser = await getCurrentUser();

  try {
    const hashedPassword = await hashPassword(adminPassword);

    let createdTenant: { id: string; name: string } | null = null;

    await prisma.$transaction(async (tx) => {
      // 1. Create Tenant
      const tenant = await tx.tenant.create({
        data: { name },
      });
      createdTenant = tenant;

      // 2. Create Admin User for Tenant
      await tx.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          password: hashedPassword,
          role: Role.TENANT_ADMIN,
          tenantId: tenant.id,
        },
      });

      // 3. Create Admin User in Cognito
      await createUserWithPasswordInCognito(
        adminEmail,
        adminPassword,
        Role.TENANT_ADMIN,
        adminName,
        tenant.id,
      );
    });

    void logAudit({
      userId: currentUser?.id ?? null,
      action: "TENANT_CREATED",
      resource: "Tenant",
      resourceId: createdTenant!.id,
      details: { tenantName: name, adminEmail },
      status: "SUCCESS",
      ipAddress: await extractIpFromHeaders(),
    });

    revalidatePath("/tenants");
    return { success: true };
  } catch (error) {
    console.error("Failed to create tenant:", error);
    return {
      success: false,
      error: "Failed to create tenant. Email might already be in use.",
    };
  }
}

export async function deleteTenant(tenantId: string) {
  const currentUser = await getCurrentUser();

  if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });

  if (!tenant) {
    return { success: false, error: "Tenant not found" };
  }

  const ipAddress = await extractIpFromHeaders();

  // Fire-and-forget background worker — same pattern as validateAwsAccount
  deleteTenantWorker(tenantId, tenant.name, currentUser.id, ipAddress).catch(
    (err) => {
      console.error("[deleteTenant] Worker error:", err);
    },
  );

  revalidatePath("/superadmin/tenants");
  return { success: true };
}

export async function getTenantsForFilter(): Promise<
  | { success: true; data: { id: string; name: string }[] }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const where: any = { isHubTenant: false };

    // If not platform admin, they can ONLY see their own tenant
    if (user.role !== "PLATFORM_ADMIN") {
      where.id = user.tenantId;
    }

    const data = await prisma.tenant.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { success: true, data };
  } catch (error) {
    return { success: false, error: "Failed to fetch tenants" };
  }
}

export async function updateTenant(tenantId: string, newName: string) {
  const currentUser = await getCurrentUser();

  if (!currentUser || currentUser.role !== "PLATFORM_ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  if (!newName || newName.trim() === "") {
    return { success: false, error: "Tenant name cannot be empty" };
  }

  try {
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { name: newName.trim() },
    });

    void logAudit({
      userId: currentUser.id,
      action: "TENANT_UPDATED",
      resource: "Tenant",
      resourceId: tenant.id,
      details: { oldName: tenant.name, newName: newName.trim() },
      status: "SUCCESS",
      ipAddress: await extractIpFromHeaders(),
    });

    revalidatePath("/superadmin/tenants");
    revalidatePath(`/superadmin/tenants/${tenantId}`);

    return { success: true, data: { id: tenant.id, name: tenant.name } };
  } catch (error) {
    console.error("Failed to update tenant:", error);
    return { success: false, error: "Failed to update tenant name" };
  }
}
