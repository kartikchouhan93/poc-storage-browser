import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { logAudit } from '@/lib/audit';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ teamId: string }> }
) {
    try {
        const user = await getCurrentUser();
        if (!user || user.role !== 'TENANT_ADMIN' || !user.tenantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { teamId } = await params;

        const { userId } = await request.json();
        if (!userId) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
        }

        // Verify the user being added belongs to the same tenant
        const userToAdd = await prisma.user.findFirst({
            where: { id: userId, tenantId: user.tenantId }
        });

        if (!userToAdd) {
            return NextResponse.json({ error: 'User not found or not in your tenant' }, { status: 404 });
        }

        // Verify the team belongs to the tenant
        const team = await prisma.team.findFirst({
            where: { id: teamId, tenantId: user.tenantId }
        });

        if (!team) {
            return NextResponse.json({ error: 'Team not found' }, { status: 404 });
        }

        // Use upsert to resurrect a soft-deleted membership or create a new one
        const membership = await prisma.teamMembership.upsert({
            where: {
                userId_teamId: {
                    userId,
                    teamId
                }
            },
            update: {
                isDeleted: false
            },
            create: {
                teamId,
                userId,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        role: true
                    }
                }
            }
        });

        logAudit({
            userId: user.id,
            action: "TEAM_MEMBER_ADDED",
            resource: "TeamMembership",
            resourceId: membership.id,
            status: "SUCCESS",
            details: { teamId, targetUserId: userId }
        });

        return NextResponse.json(membership);
    } catch (error: any) {
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'User is already in this team' }, { status: 400 });
        }
        console.error("Add member error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
