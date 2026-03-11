/**
 * CloudVault Enterprise — Database Seed Script
 * Creates only the Platform Admin user. Safe to run multiple times.
 *
 * USAGE:
 *   DATABASE_URL='...' npx tsx prisma/seed.ts
 */

import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

// Strip ?schema=... from connection string — pg handles search_path separately
const rawUrl = process.env.DATABASE_URL || "";
const connectionString = rawUrl.replace(/[?&]schema=[^&]+/, "");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Set search_path to public so all tables are found
pool.on("connect", (client) => {
  client.query("SET search_path TO public");
});

const adapter = new PrismaPg(pool);
// @ts-ignore
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("\n🌱 Seeding platform admin...\n");

  const email = "admin@fms.com";

  // Ensure a hub tenant exists for the platform admin
  let hubTenant = await prisma.tenant.findFirst({ where: { isHubTenant: true } });
  if (!hubTenant) {
    hubTenant = await prisma.tenant.create({
      data: { name: "Platform Hub", isHubTenant: true },
    });
    console.log(`  ✅ Created hub tenant: ${hubTenant.id}`);
  }

  const existing = await prisma.user.findFirst({
    where: { email, tenantId: hubTenant.id },
  });

  if (existing) {
    console.log(`  ⏭️  Platform admin already exists: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        name: "Platform Admin",
        role: "PLATFORM_ADMIN",
        tenantId: hubTenant.id,
      },
    });
    console.log(`  ✅ Created platform admin: ${email}`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Platform Admin : admin@fms.com
 NOTE: Also create this user in Cognito
       with custom:role = PLATFORM_ADMIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seeding failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
