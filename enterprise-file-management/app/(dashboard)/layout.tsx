import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser();

  if (!user) return redirect('/login');
  if (user.role === 'PLATFORM_ADMIN') return redirect('/superadmin');

  const sidebarUser = {
    id: user.id,
    email: user.email,
    name: user.name ?? user.email,
    role: user.role,
    tenantId: user.tenantId ?? '',
    tenantName: user.tenant?.name,
  };

  return (
    <SidebarProvider>
      <AppSidebar serverUser={sidebarUser} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}

