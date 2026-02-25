import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { logAudit } from '@/lib/audit';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ teamId: string, userId: string }> }) {
    try {
        const { teamId, userId } = await params;
        const user = await getCurrentUser();
        if (!user || user.role !== 'TENANT_ADMIN' || !user.tenantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Must verify team belongs to tenant to prevent deleting from another tenant's team
        const team = await prisma.team.findFirst({
            where: { id: teamId, tenantId: user.tenantId }
        });

        if (!team) {
            return NextResponse.json({ error: 'Team not found' }, { status: 404 });
        }

        const existingMembership = await prisma.teamMembership.findUnique({
            where: {
                userId_teamId: {
                    userId,
                    teamId
                }
            }
        });

        if (!existingMembership) {
             return NextResponse.json({ error: 'Member not found in team' }, { status: 404 });
        }

        await prisma.teamMembership.update({
            where: {
                id: existingMembership.id
            },
            data: {
                isDeleted: true
            }
        });

        logAudit({
            userId: user.id,
            action: "TEAM_MEMBER_REMOVED",
            resource: "TeamMembership",
            status: "SUCCESS",
            details: { teamId, targetUserId: userId }
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        if (error.code === 'P2025') {
            return NextResponse.json({ error: 'Member not found in team' }, { status: 404 });
        }
        console.error("Remove member error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
