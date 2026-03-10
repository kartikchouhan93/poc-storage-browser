'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';

export default function PendingAssignmentPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full text-center space-y-6 p-8">
        <div className="flex justify-center">
          <div className="rounded-full bg-muted p-4">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Pending Tenant Assignment</h1>
          <p className="text-muted-foreground text-sm">
            Your account (<span className="font-medium">{user?.email}</span>) has been created
            but hasn&apos;t been assigned to a tenant yet.
          </p>
          <p className="text-muted-foreground text-sm">
            Please contact your administrator to get access.
          </p>
        </div>

        <Button variant="outline" onClick={logout} className="w-full">
          Sign out
        </Button>
      </div>
    </div>
  );
}
