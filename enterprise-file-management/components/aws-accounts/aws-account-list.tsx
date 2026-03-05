"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Cloud, Search, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { triggerAccountValidation } from "@/app/actions/aws-accounts"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface AwsAccount {
    id: string
    tenantId: string
    awsAccountId: string
    region: string
    friendlyName: string
    status: string
    lastValidatedAt: string | null
    createdAt: string
    tenant: {
        name: string
    }
}

interface AwsAccountListProps {
    initialAccounts: AwsAccount[]
}

const getStatusBadgeVariant = (status: string) => {
    switch (status) {
        case "CONNECTED":
            return "default"
        case "CREATING":
        case "PENDING_VALIDATION":
            return "secondary"
        case "FAILED":
        case "DISCONNECTED":
            return "destructive"
        default:
            return "outline"
    }
}

export function AwsAccountList({ initialAccounts }: AwsAccountListProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [validatingId, setValidatingId] = useState<string | null>(null)
    const [accountToDelete, setAccountToDelete] = useState<AwsAccount | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    const router = useRouter()
    const { toast } = useToast()

    const filteredAccounts = initialAccounts.filter(acc =>
        acc.friendlyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        acc.awsAccountId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        acc.tenant.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="flex-1 overflow-auto p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">AWS Accounts</h1>
                    <p className="text-muted-foreground">
                        Manage linked customer AWS accounts.
                    </p>
                </div>
                <Button asChild>
                    <Link href="/superadmin/aws-accounts/link">
                        <Plus className="mr-2 h-4 w-4" />
                        Link AWS Account
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>All AWS Accounts</CardTitle>
                            <CardDescription>
                                List of all registered AWS accounts across all tenants.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search accounts..."
                                    className="pl-8 w-[250px]"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Button variant="outline" size="icon" onClick={() => router.refresh()} title="Refresh list">
                                <RefreshCw className="h-4 w-4" />
                                <span className="sr-only">Refresh List</span>
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Account Name</TableHead>
                                <TableHead>Tenant</TableHead>
                                <TableHead>AWS Account ID</TableHead>
                                <TableHead>Region</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Last Validated</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredAccounts.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                        No linked AWS accounts found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredAccounts.map((account) => (
                                    <TableRow key={account.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                                                    <Cloud className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <div className="font-semibold">{account.friendlyName}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>{account.tenant.name}</TableCell>
                                        <TableCell className="font-mono text-sm">{account.awsAccountId}</TableCell>
                                        <TableCell>{account.region}</TableCell>
                                        <TableCell>
                                            <Badge variant={getStatusBadgeVariant(account.status)}>
                                                {account.status.replace("_", " ")}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-muted-foreground">
                                            {account.lastValidatedAt 
                                                ? new Date(account.lastValidatedAt).toLocaleString() 
                                                : "Never"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                onClick={async () => {
                                                    setValidatingId(account.id)
                                                    const res = await triggerAccountValidation(account.id)
                                                    if (res.success) {
                                                        toast({ title: "Validation Started", description: "AWS Account validation queued." })
                                                        router.refresh()
                                                    } else {
                                                        toast({ title: "Error", description: res.error || "Validation trigger failed.", variant: "destructive" })
                                                    }
                                                    setValidatingId(null)
                                                }}
                                                disabled={validatingId === account.id || account.status === "CREATING" || account.status === "PENDING_VALIDATION"}
                                                title="Validate Connection"
                                            >
                                                <RefreshCw className={`h-4 w-4 ${validatingId === account.id ? "animate-spin" : ""}`} />
                                                <span className="sr-only">Validate</span>
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50"
                                                onClick={() => setAccountToDelete(account)}
                                                title="Delete Connection"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                <span className="sr-only">Delete</span>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <AlertDialog open={!!accountToDelete} onOpenChange={(open) => !open && setAccountToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure you want to delete this AWS Account?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently remove the connection for <strong>{accountToDelete?.tenant.name}</strong> to the AWS Account <strong>{accountToDelete?.awsAccountId}</strong>.
                            <br /><br />
                            <span className="text-red-500 font-semibold mb-2 block">Warning:</span>
                            This action will be blocked if any active S3 buckets are still mapped to this account.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                            disabled={isDeleting}
                            onClick={async (e) => {
                                e.preventDefault()
                                if (!accountToDelete) return
                                setIsDeleting(true)
                                try {
                                    const res = await fetch(`/api/aws-accounts/${accountToDelete.id}`, {
                                        method: "DELETE"
                                    })
                                    const result = await res.json()
                                    if (result.success) {
                                        toast({ title: "Account Deleted", description: "AWS Account connection removed successfully." })
                                        setAccountToDelete(null)
                                        router.refresh()
                                    } else {
                                        toast({ title: "Deletion Failed", description: result.error || "Failed to delete account.", variant: "destructive" })
                                        setAccountToDelete(null)
                                    }
                                } catch (err) {
                                    toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" })
                                    setAccountToDelete(null)
                                } finally {
                                    setIsDeleting(false)
                                }
                            }}
                        >
                            {isDeleting ? "Deleting..." : "Delete Account"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
