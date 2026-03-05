import { getTenants } from "@/app/actions/tenants"
import { TenantList } from "@/components/tenants/tenant-list"

export default async function SuperAdminTenantsPage() {
    const { data: rawTenants = [] } = await getTenants()

    const tenants = rawTenants?.map((t: any) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
    }))

    return (
        <div className="flex flex-col h-full w-full">
            <TenantList initialTenants={tenants || []} showAwsLink={true} />
        </div>
    )
}
