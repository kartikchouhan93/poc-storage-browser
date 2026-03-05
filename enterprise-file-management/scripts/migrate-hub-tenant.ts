import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Migrating Hub Tenant...");

  // Update SMC Platform to be the Hub Tenant
  const result = await prisma.tenant.updateMany({
    where: {
      name: "SMC Platform",
    },
    data: {
      isHubTenant: true,
    },
  });

  console.log(`Updated ${result.count} tenant(s) to be Hub Tenant.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
