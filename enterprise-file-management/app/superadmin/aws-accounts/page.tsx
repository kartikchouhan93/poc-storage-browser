import { getAwsAccounts } from "@/app/actions/aws-accounts"
import { AwsAccountList } from "@/components/aws-accounts/aws-account-list"

export default async function SuperAdminAwsAccountsPage() {
    const { data: rawAccounts = [] } = await getAwsAccounts()

    // Serialize dates to pass to client component
    const accounts = rawAccounts?.map((a: any) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        lastValidatedAt: a.lastValidatedAt ? a.lastValidatedAt.toISOString() : null,
    })) || []

    return (
        <div className="flex flex-col h-full w-full">
            <AwsAccountList initialAccounts={accounts} />
        </div>
    )
}
