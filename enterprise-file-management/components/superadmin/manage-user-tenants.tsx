"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Search, Trash2 } from "lucide-react"

type Role = "PLATFORM_ADMIN" | "TENANT_ADMIN" | "TEAM_ADMIN" | "TEAMMATE"

interface Assignment {
  userId: string
  tenantId: string
  tenantName: string | null
  role: Role
  email: string
  name: string | null
}

const ROLES: Role[] = ["TEAMMATE", "TEAM_ADMIN", "TENANT_ADMIN", "PLATFORM_ADMIN"]

export function ManageUserTenants() {
  const [email, setEmail] = useState("")
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  // Assign form state
  const [assignTenantId, setAssignTenantId] = useState("")
  const [assignRole, setAssignRole] = useState<Role>("TEAMMATE")
  const [assigning, setAssigning] = useState(false)

  async function lookupUser() {
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    setMessage(null)
    setAssignments([])
    try {
      const res = await fetch(`/api/admin/users/assignments?email=${encodeURIComponent(email.trim())}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to look up user")
      setAssignments(data)
      if (data.length === 0) setMessage("No assignments found for this email.")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function assignToTenant() {
    if (!email.trim() || !assignTenantId.trim()) return
    setAssigning(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch("/api/admin/users/assign-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), tenantId: assignTenantId.trim(), role: assignRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to assign tenant")
      setMessage("User assigned to tenant successfully.")
      setAssignTenantId("")
      setAssignRole("TEAMMATE")
      await refreshAssignments()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setAssigning(false)
    }
  }

  async function removeAssignment(userId: string) {
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to remove assignment")
      setMessage("Assignment removed.")
      setConfirmRemove(null)
      await refreshAssignments()
    } catch (e: any) {
      setError(e.message)
      setConfirmRemove(null)
    }
  }

  async function updateRole(userId: string, role: Role) {
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to update role")
      setMessage("Role updated.")
      setAssignments((prev) =>
        prev.map((a) => (a.userId === userId ? { ...a, role } : a))
      )
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function refreshAssignments() {
    if (!email.trim()) return
    const res = await fetch(`/api/admin/users/assignments?email=${encodeURIComponent(email.trim())}`)
    if (res.ok) setAssignments(await res.json())
  }

  return (
    <div className="space-y-6">
      {/* Email lookup */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="user-email">User Email</Label>
          <Input
            id="user-email"
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookupUser()}
          />
        </div>
        <Button onClick={lookupUser} disabled={loading || !email.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ml-2">Look up</span>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* Assignments table */}
      {assignments.length > 0 && (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant Name</TableHead>
                <TableHead>Tenant ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.userId}>
                  <TableCell className="font-medium">{a.tenantName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{a.tenantId}</TableCell>
                  <TableCell>
                    <Select
                      value={a.role}
                      onValueChange={(val) => updateRole(a.userId, val as Role)}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {confirmRemove === a.userId ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => removeAssignment(a.userId)}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmRemove(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmRemove(a.userId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Assign to tenant form */}
          <div className="border rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium">Assign to Tenant</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <Label htmlFor="assign-tenant-id">Tenant ID</Label>
                <Input
                  id="assign-tenant-id"
                  placeholder="Enter tenant ID"
                  value={assignTenantId}
                  onChange={(e) => setAssignTenantId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Paste the tenant's UUID</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="assign-role">Role</Label>
                <Select value={assignRole} onValueChange={(v) => setAssignRole(v as Role)}>
                  <SelectTrigger id="assign-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={assignToTenant}
                disabled={assigning || !assignTenantId.trim()}
              >
                {assigning && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Assign
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
