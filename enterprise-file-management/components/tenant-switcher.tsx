'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Check } from 'lucide-react';

export function TenantSwitcher() {
  const { tenants, activeTenantId, switchTenant } = useAuth();

  // 6.2: Hidden when user has ≤1 tenant
  if (!tenants || tenants.length <= 1) return null;

  const activeTenant = tenants.find(t => t.tenantId === activeTenantId);

  return (
    <Select value={activeTenantId ?? ''} onValueChange={switchTenant}>
      <SelectTrigger className="w-full">
        <Building2 className="mr-2 h-4 w-4 shrink-0" />
        <SelectValue placeholder="Select tenant">
          {activeTenant?.tenantName ?? 'Select tenant'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {tenants.map((t) => (
          <SelectItem key={t.tenantId} value={t.tenantId}>
            <div className="flex items-center gap-2">
              {/* 6.4: Visual indicator for active tenant */}
              {t.tenantId === activeTenantId ? (
                <Check className="h-3 w-3 text-primary shrink-0" />
              ) : (
                <span className="h-3 w-3 shrink-0" />
              )}
              <span>{t.tenantName}</span>
              <span className="text-xs text-muted-foreground ml-auto pl-4">{t.role}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
