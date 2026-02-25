
import { useAuth } from '@/components/providers/AuthProvider';

interface ResourceContext {
    tenantId?: string;
    resourceType: 'bucket' | 'folder' | 'object' | 'account' | 'tenant' | 'user' | 'team' | 'policy';
    resourceId?: string;
}

export type Action = 'READ' | 'WRITE' | 'DELETE' | 'LIST' | 'CREATE' | 'UPDATE';

export function usePermission() {
    const { user } = useAuth();

    const can = (action: Action, context: ResourceContext): boolean => {
        if (!user) return false;

        // 1. Platform Admin
        if (user.role === 'PLATFORM_ADMIN') return true;

        // 2. Tenant Isolation
        if (context.tenantId && user.tenantId !== context.tenantId) return false;

        // 3. Tenant Admin
        if (user.role === 'TENANT_ADMIN') return true;

        // 4. Teammate Policy Check (Combine direct policies and team policies)
        let allPolicies: any[] = [];
        
        if (user.policies) {
            allPolicies = [...allPolicies, ...user.policies];
        }

        if (user.teams) {
            user.teams.forEach((membership: any) => {
                if (membership.team && membership.team.policies) {
                    allPolicies = [...allPolicies, ...membership.team.policies];
                }
            });
        }

        return allPolicies.some((policy: any) => {
            const typeMatch = policy.resourceType === context.resourceType;
            const idMatch = policy.resourceId === null || policy.resourceId === undefined || policy.resourceId === context.resourceId;
            const actionMatch = policy.actions.includes(action);
            return typeMatch && idMatch && actionMatch;
        });
    };

    return { can };
}
