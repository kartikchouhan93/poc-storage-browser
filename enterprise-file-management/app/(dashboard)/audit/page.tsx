import * as React from "react";
import {
  ArrowDownToLine,
  Eye,
  FileUp,
  Plus,
  Share2,
  Trash2,
  Upload,
  UserPlus,
  RefreshCw,
  Download,
} from "lucide-react";
import { CostChart } from "@/components/audit/cost-chart";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mockCostData, formatDateTime } from "@/lib/mock-data";
import { SearchCommandDialog } from "@/components/search-command";
import { getAuditLogs } from "@/app/actions/audit";
import { AuditLog } from "@/lib/generated/prisma/client";

const actionIcons: Record<string, React.ElementType> = {
  upload: Upload,
  download: Download,
  share: Share2,
  delete: Trash2,
  create_bucket: Plus,
  modify: FileUp,
  view: Eye,
  invite_user: UserPlus,
  sync: RefreshCw,
};

const actionColors: Record<string, string> = {
  upload: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  download: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  share: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  delete: "bg-red-500/10 text-red-600 dark:text-red-400",
  create_bucket: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  modify: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  view: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  invite_user: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  sync: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

const latestCost = mockCostData[mockCostData.length - 1];

export default async function AuditPage() {
  // We can eventually move actionFilter to a URL search parameter to make this fully SSR-friendly with filters
  // For now, replacing the client-side state with server-fetched data. The filter tab will still be there but
  // currently we'll just display all logs for MVP, or we can use a client component wrapper.
  // To keep it simple, we'll fetch all logs up front.

  const result = await getAuditLogs();
  const logs = result.success ? (result.data as any[]) : [];

  return (
    <>
      <SearchCommandDialog />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-6">
        <SidebarTrigger className="-ml-2" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Audit & Sync Logs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Audit & Sync Logs
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor storage costs, manage file syncing activities, and review
              user audit logs.
            </p>
          </div>

     
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  {/* Filter disabled temporarily while moving to SSR logs */}
                  <Select defaultValue="all" disabled>
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                      <SelectValue placeholder="Filter by action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Actions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ArrowDownToLine className="h-4 w-4" />
                  Export CSV
                </Button>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Action</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead className="hidden md:table-cell">
                        File
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Bucket
                      </TableHead>
                      <TableHead className="hidden lg:table-cell">
                        IP Address
                      </TableHead>
                      <TableHead>Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => {
                      // Map standardized DB action names to our icon keys
                      // e.g., FILE_UPLOAD -> upload, FOLDER_CREATE -> create_bucket, TEAM_MEMBER_ADDED -> invite_user
                      let iconKey = "view";
                      const action = log.action.toLowerCase();

                      if (action.includes("upload")) iconKey = "upload";
                      else if (action.includes("download"))
                        iconKey = "download";
                      else if (
                        action.includes("delete") ||
                        action.includes("remove")
                      )
                        iconKey = "delete";
                      else if (
                        action.includes("share") ||
                        action.includes("permission")
                      )
                        iconKey = "share";
                      else if (action.includes("create"))
                        iconKey = "create_bucket";
                      else if (
                        action.includes("team") ||
                        action.includes("login")
                      )
                        iconKey = "invite_user";

                      const Icon = actionIcons[iconKey] || Eye;

                      const details = (log.details as any) || {};
                      const resourceId = log.resourceId || "-";
                      const displayResource =
                        details.name ||
                        details.key ||
                        details.email ||
                        resourceId;

                      return (
                        <TableRow key={log.id}>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={`gap-1 capitalize ${
                                actionColors[iconKey] || actionColors["view"]
                              }`}
                            >
                              <Icon className="h-3 w-3" />
                              {log.action.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">
                                {log.user?.name || "Unknown"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {log.user?.email || "N/A"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell
                            className="hidden md:table-cell text-sm text-muted-foreground max-w-[200px] truncate"
                            title={displayResource}
                          >
                            {displayResource}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                            {details.bucketName || (details.bucketId ? "S3 Bucket" : log.resource.split(':')[0])}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground font-mono text-xs">
                            {details.ip || "System"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {formatDateTime(log.createdAt.toISOString())}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {logs.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No audit logs found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
           
        </div>
      </div>
    </>
  );
}
