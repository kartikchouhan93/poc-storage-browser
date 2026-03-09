import { PrismaClient } from "../../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Reuse across warm invocations
let prisma: PrismaClient;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // AWS RDS requires SSL. We bypass strict cert verification for the POC.
      ssl: { rejectUnauthorized: false },
    });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter } as any);
  }
  return prisma;
}
