'use server'

import prisma from "@/lib/prisma"
import { getCurrentUser } from "@/lib/session"
import { inviteUserToCognito, updateUserRoleInCognito } from "@/lib/auth-service"
import { Role } from "@/lib/generated/prisma/client"
import { revalidatePath } from "next/cache"

export async function getUsers() {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser) {
            return { success: false, error: "Unauthorized" }
        }

        let whereClause = {};
        if (currentUser.role !== "PLATFORM_ADMIN") {
            if (!currentUser.tenantId) {
                return { success: false, error: "Unauthorized" };
            }
            whereClause = { tenantId: currentUser.tenantId };
        }

        const users = await prisma.user.findMany({
            where: whereClause,
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                tenant: true,
                teams: {
                    include: {
                        team: true
                    }
                }
            },
        })

        return { success: true, data: users }
    } catch (error) {
        console.error("Failed to fetch users:", error)
        return { success: false, error: "Failed to fetch users" }
    }
}

export async function inviteUser(formData: FormData) {
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const role = formData.get("role") as Role
    const tenantId = formData.get("tenantId") as string

    if (!email || !role || !tenantId) {
        return { success: false, error: "Missing required fields" }
    }

    try {
        const currentUser = await getCurrentUser()
        if (!currentUser) {
            return { success: false, error: "Unauthorized" }
        }

        console.log("@@@ currentUse", currentUser)

        if (currentUser.role !== "PLATFORM_ADMIN") {
            if (currentUser.role !== "TENANT_ADMIN" || currentUser.tenantId !== tenantId) {
                return { success: false, error: `Unauthorized to invite to this tenant. Expected role TENANT_ADMIN, got ${currentUser.role}. Expected tenant ${tenantId}, got ${currentUser.tenantId}.` }
            }
        }

        // Invite User to Cognito (sends magic link/temp password)
        await inviteUserToCognito(email, tenantId, role, name)

        // Save user in database 
        await prisma.user.create({
            data: {
                name,
                email,
                role,
                tenantId,
            }
        })

        revalidatePath("/users")
        return { success: true }

    } catch (error) {
        console.error("Failed to invite user:", error)
        return { success: false, error: "Failed to invite user. Email might be in use." }
    }
}

export async function updateUserRole(userId: string, newRole: Role) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser) {
            return { success: false, error: "Unauthorized" }
        }

        const targetUser = await prisma.user.findUnique({ where: { id: userId } })
        if (!targetUser) {
            return { success: false, error: "User not found" }
        }

        if (currentUser.role !== "PLATFORM_ADMIN") {
            if (currentUser.role !== "TENANT_ADMIN" || currentUser.tenantId !== targetUser.tenantId) {
                return { success: false, error: "Unauthorized to modify this user's role" }
            }
        }

        // Prevent tenant admin from demoting themselves (optional, but good practice)
        if (currentUser.id === userId && currentUser.role === "TENANT_ADMIN" && newRole !== "TENANT_ADMIN") {
            return { success: false, error: "Cannot demote yourself" }
        }

        // 1. Update Cognito so the next session gets the correct token
        await updateUserRoleInCognito(targetUser.email, newRole);

        // 2. Update Database
        await prisma.user.update({
            where: { id: userId },
            data: { role: newRole }
        })

        revalidatePath("/users")
        return { success: true }
    } catch (error) {
        console.error("Failed to change user role:", error)
        return { success: false, error: "Failed to update user role" }
    }
}
