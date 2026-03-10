import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
    // 3.1: Read x-active-tenant-id from request headers or cookies
    const activeTenantId =
        request.headers.get('x-active-tenant-id') ||
        request.cookies.get('x-active-tenant-id')?.value;

    const user = await getCurrentUser(activeTenantId);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 3.2: Query all User rows for the same email to build tenants array
    const allUsers = await prisma.user.findMany({
        where: { email: user.email },
        include: { tenant: true },
    });

    const tenants = allUsers.map((u) => ({
        userId: u.id,
        tenantId: u.tenantId,
        tenantName: u.tenant?.name || '',
        role: u.role,
    }));

    return NextResponse.json({
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        role: user.role,
        tenantId: user.tenantId || '',
        tenantName: (user as any).tenant?.name || '',
        policies: user.policies || [],
        teams: user.teams || [],
        tenants,
    });
}
