"use client";

import * as React from "react";
import { InviteUserModal } from "./invite-user-modal";
import { DataTable, ColumnDef } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TeamMappingModal } from "./team-mapping-modal";
import { ChangeRoleModal } from "./change-role-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Users, Shield, Trash2, Mail } from "lucide-react";
import { usePermission } from "@/lib/hooks/usePermission";

interface UserItem {
  id: string;
  name: string | null;
  email: string;
  role: string;
  tenantName: string;
  createdAt: string;
  status?: string;
  hasLoggedIn?: boolean;
  teams?: any[];
}

interface TenantItem {
  id: string;
  name: string;
}

interface TeamItem {
  id: string;
  name: string;
}

interface UserListProps {
  initialUsers: UserItem[];
  tenants: TenantItem[];
  availableTeams: TeamItem[];
}

import { useAuth } from "@/components/providers/AuthProvider";
import { useRouter } from "next/navigation";

export function UserList({ initialUsers, tenants, availableTeams }: UserListProps) {
  const { user } = useAuth();
  const router = useRouter();
  
  React.useEffect(() => {
    if (user && user.role !== "PLATFORM_ADMIN" && user.role !== "TENANT_ADMIN") {
      router.replace("/");
    }
  }, [user, router]);

  const { can } = usePermission();
  const [users, setUsers] = React.useState<UserItem[]>(initialUsers);
  const [searchTerm, setSearchTerm] = React.useState("");
  
  // Team Mapping Modal State
  const [mappingUser, setMappingUser] = React.useState<UserItem | null>(null);
  const [isMappingOpen, setIsMappingOpen] = React.useState(false);

  // Change Role Modal State
  const [roleUser, setRoleUser] = React.useState<UserItem | null>(null);
  const [isRoleOpen, setIsRoleOpen] = React.useState(false);

  React.useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  if (user && user.role !== "PLATFORM_ADMIN" && user.role !== "TENANT_ADMIN") {
    return null;
  }

  const filteredUsers = users.filter(
    (user) =>
      user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.tenantName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleMapTeams = (user: UserItem) => {
    setMappingUser(user);
    setIsMappingOpen(true);
  };

  const handleChangeRole = (user: UserItem) => {
    setRoleUser(user);
    setIsRoleOpen(true);
  };

  const columns: ColumnDef<UserItem>[] = [
    {
      header: "User",
      accessorKey: "name",
      cell: (user) => (
        <div className="flex items-center gap-3 w-full min-w-0">
          <Avatar className="h-9 w-9 border">
            <AvatarFallback className="bg-primary/5 text-primary text-xs font-semibold">
              {user.name?.substring(0, 2).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col truncate">
            <span className="font-semibold text-sm truncate">
              {user.name || "Unknown"}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {user.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      header: "Role",
      accessorKey: "role",
      cell: (user) => (
        <Badge variant="outline" className="capitalize bg-background">
          {user.role.toLowerCase().replace("_", " ")}
        </Badge>
      ),
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (user) => {
        const isActive = user.hasLoggedIn;
        return (
          <Badge variant={isActive ? "secondary" : "outline"} className={isActive ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25" : "text-muted-foreground"}>
            {isActive ? "Active" : "Pending Invite"}
          </Badge>
        );
      },
    },
    {
      header: "Tenant",
      accessorKey: "tenantName",
      cell: (user) => (
        <span className="text-sm font-medium">{user.tenantName}</span>
      ),
    },
    {
      header: "Teams part of",
      accessorKey: "teams",
      cell: (user) => {
        const teamNames = user.teams?.map((t: any) => t.team.name).filter(Boolean);
        if (!teamNames || teamNames.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {teamNames.map((name: string, idx: number) => (
              <Badge key={idx} variant="secondary" className="font-normal text-[10px] px-1.5 py-0 h-5">
                {name}
              </Badge>
            ))}
          </div>
        );
      }
    },
    {
      header: "Joined",
      accessorKey: "createdAt",
      cell: (user) => (
        <span className="text-sm text-muted-foreground">
          {new Date(user.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })}
        </span>
      ),
      className: "text-right hidden md:table-cell",
    },
    {
      header: "",
      accessorKey: "actions",
      className: "w-10",
      cell: (user) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 focus-visible:ring-0">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => handleMapTeams(user)}>
              <Users className="mr-2 h-4 w-4" />
              Map Teams
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleChangeRole(user)} disabled={!can('UPDATE', { resourceType: 'user' })}>
              <Shield className="mr-2 h-4 w-4" />
              Change Role
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Mail className="mr-2 h-4 w-4" />
              Resend Invite
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              disabled={!can('DELETE', { resourceType: 'user' })}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete User
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="p-6 h-full flex flex-col space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground mt-1">
            Manage users and roles within your tenant.
          </p>
        </div>
        {can('CREATE', { resourceType: 'user' }) && (
          <InviteUserModal tenants={tenants} />
        )}
      </div>

      <div className="flex-1 bg-background rounded-lg border shadow-sm p-4">
        <DataTable
          data={filteredUsers}
          columns={columns}
          searchPlaceholder="Search users by name, email, or tenant..."
          onSearch={setSearchTerm}
          selectable={true}
          emptyMessage="No users found."
          onRowContextMenu={(e, user) => {
            e.preventDefault();
            handleMapTeams(user);
          }}
        />
      </div>

      <TeamMappingModal
        isOpen={isMappingOpen}
        onClose={() => setIsMappingOpen(false)}
        user={mappingUser}
        availableTeams={availableTeams}
        onSuccess={() => {}}
      />

      <ChangeRoleModal
        isOpen={isRoleOpen}
        onClose={() => setIsRoleOpen(false)}
        user={roleUser}
        onSuccess={() => {
          // Revalidated by server action
        }}
      />
    </div>
  );
}
