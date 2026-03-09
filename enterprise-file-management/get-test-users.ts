// A small script to get a valid token directly from the database or mock auth for quick curl testing.
import { PrismaClient } from "@prisma/client";
import { signToken } from "./lib/token"; // assuming this exists or we can mock it

const prisma = new PrismaClient();

async function getTestTokens() {
  try {
    // Get a platform/tenant admin for setup
    const admin = await prisma.user.findFirst({
      where: { role: "TENANT_ADMIN" },
    });

    // Get a regular teammate for testing access
    const teammate = await prisma.user.findFirst({
      where: { role: "TEAMMATE" },
    });

    if (!admin || !teammate) {
      console.log(
        "Missing test users in DB. Required: one TENANT_ADMIN and one TEAMMATE.",
      );
      process.exit(1);
    }

    // Create actual signed JWT tokens for these users
    // If the standard auth flow uses Cognito, we might need a workaround script
    // to bypass or mock the JWT requirement for a localized curl test.

    console.log("Admin Email:", admin.email);
    console.log("Admin ID:", admin.id);

    console.log("Teammate Email:", teammate.email);
    console.log("Teammate ID:", teammate.id);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

getTestTokens();
