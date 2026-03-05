import { getTenants } from "@/app/actions/tenants"
import { LinkAwsAccountForm } from "@/components/aws-accounts/link-aws-account-form"

export default async function LinkAwsAccountPage() {
    // Fetch tenants so platform admins can assign the linked account to a tenant
    const { data: rawTenants = [] } = await getTenants()
    
    const tenants = rawTenants?.map((t: any) => ({
        id: t.id,
        name: t.name,
    })) || []

    return (
        <div className="flex-1 overflow-auto p-6 flex justify-center">
            <div className="w-full max-w-4xl">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold tracking-tight">Link AWS Account</h1>
                    <p className="text-muted-foreground">
                        Follow the steps below to securely connect a customer's AWS account.
                    </p>
                </div>
                
                <LinkAwsAccountForm tenants={tenants} />
            </div>
        </div>
    )
}
