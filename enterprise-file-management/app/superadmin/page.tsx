"use client"

import { useEffect, useState, useCallback } from "react"
import { getPlatformStats } from "@/app/actions/platform-stats"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Building2, Users, HardDrive, FolderOpen, Cloud, Bot,
  CheckCircle2, AlertCircle, Clock, RefreshCw, AlertTriangle
} from "lucide-react"
import Link from "next/link"
import { formatBytes } from "@/lib/mock-data"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type Stats = Awaited<ReturnType<typeof getPlatformStats>>

function StatCard({ title, value, sub, icon: Icon, loading }: {
  title: string; value: string | number; sub?: string; icon: React.ElementType; loading?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <><Skeleton className="h-7 w-20 mb-1" /><Skeleton className="h-3 w-28" /></>
        ) : (
          <>
            <div className="text-2xl font-semibold tracking-tight">{value}</div>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AwsStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline" className="text-xs">None</Badge>
  if (status === "CONNECTED") return <Badge variant="default" className="text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Connected</Badge>
  if (status === "FAILED" || status === "DISCONNECTED") return <Badge variant="destructive" className="text-xs gap-1"><AlertCircle className="h-3 w-3" />{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>
  return <Badge variant="secondary" className="text-xs gap-1"><Clock className="h-3 w-3" />Pending</Badge>
}

export default function SuperAdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [timeRange, setTimeRange] = useState("all")
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (range?: string) => {
    try {
      setError(null)
      const filters = { timeRange: range ?? timeRange }
      const data = await getPlatformStats(filters)
      setStats(data)
    } catch (err: any) {
      console.error("Dashboard fetch error:", err)
      setError(err.message || "Failed to load dashboard statistics. Please try again later.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [timeRange])

  useEffect(() => { fetchData() }, [timeRange])

  const handleRefresh = () => { setRefreshing(true); fetchData() }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Dashboard</h1>
          <p className="text-muted-foreground text-sm">Overview of all tenants, infrastructure, and activity.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="14d">Last 14 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error}
          </AlertDescription>
        </Alert>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Tenants" value={stats?.tenantCount ?? 0} sub="registered orgs" icon={Building2} loading={loading} />
        <StatCard title="Active Users" value={stats?.userCount ?? 0} sub="across all tenants" icon={Users} loading={loading} />
        <StatCard title="Total Files" value={stats?.totalFiles.toLocaleString() ?? "0"} sub={stats ? formatBytes(stats.totalStorageBytes) : ""} icon={FolderOpen} loading={loading} />
        <StatCard title="Storage Used" value={stats ? formatBytes(stats.totalStorageBytes) : "0 B"} sub={stats ? `${stats.bucketCount} buckets` : ""} icon={HardDrive} loading={loading} />
        <StatCard title="AWS Accounts" value={stats ? `${stats.awsConnected}/${stats.awsTotal}` : "0/0"} sub="connected" icon={Cloud} loading={loading} />
        <StatCard title="Active Bots" value={stats?.botCount ?? 0} sub="online agents" icon={Bot} loading={loading} />
      </div>

      {/* AWS Health + Quick Actions + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AWS Account Health</CardTitle>
            <CardDescription>Cross-account integration status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Connected
              </div>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats?.awsConnected ?? 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                <Clock className="h-4 w-4" /> Pending
              </div>
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats?.awsPending ?? 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4" /> Failed
              </div>
              <span className="text-2xl font-bold text-red-600 dark:text-red-400">{stats?.awsFailed ?? 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2" asChild>
              <Link href="/superadmin/tenants"><Building2 className="h-4 w-4" />Manage Tenants</Link>
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" asChild>
              <Link href="/superadmin/tenants"><Cloud className="h-4 w-4" />AWS Accounts</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.recentAuditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{log.userName}</p>
                    <p className="text-xs text-muted-foreground truncate">{log.action.replace(/_/g, " ")}</p>
                  </div>
                  <Badge variant={log.status === "SUCCESS" ? "secondary" : "destructive"} className="text-[10px] shrink-0">
                    {log.status}
                  </Badge>
                </div>
              ))}
              {(!stats || stats.recentAuditLogs.length === 0) && (
                <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tenant Overview Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Tenants</CardTitle>
          <CardDescription>Latest registered organizations</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Buckets</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead>AWS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats?.topTenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/superadmin/tenants/${t.id}`} className="flex items-center gap-2 hover:underline group">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Building2 className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-sm font-medium text-primary">{t.name}</p>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{t.userCount}</TableCell>
                  <TableCell className="text-sm">{t.bucketCount}</TableCell>
                  <TableCell className="text-sm">{formatBytes(t.storageBytes)}</TableCell>
                  <TableCell><AwsStatusBadge status={t.awsStatus} /></TableCell>
                </TableRow>
              ))}
              {(!stats || stats.topTenants.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No tenants yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
