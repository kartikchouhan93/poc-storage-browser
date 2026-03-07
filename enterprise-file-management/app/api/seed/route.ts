import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hash } from "bcryptjs";

export async function GET() {
  try {
    // 1. Ensure Tenant
    let tenant = await prisma.tenant.findFirst();
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: "Default Tenant" },
      });
      console.log("Created Tenant:", tenant.id);
    } else {
      console.log("Tenant already exists:", tenant.id);
    }

    // 2. Ensure User (Admin)
    const email = "admin@example.com";
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      const hashedPassword = await hash("password123", 10);
      user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name: "Admin User",
          role: "PLATFORM_ADMIN",
          tenantId: tenant.id,
        },
      });
      console.log("Created Admin User:", user.email);
    } else {
      console.log("Admin User already exists:", user.email);
    }

    // 3. Ensure Bucket (linked directly to tenant, no Account)
    let bucket = await prisma.bucket.findFirst({
      where: { tenantId: tenant.id },
    });

    if (!bucket) {
      bucket = await prisma.bucket.create({
        data: {
          name: "default-bucket",
          region: "ap-south-1",
          tenantId: tenant.id,
          versioning: false,
          encryption: false,
          tags: [],
        },
      });
      console.log("Created Bucket:", bucket.id);
    }

    // 4. Ensure Basic Folder Structure (Idempotent check)
    const ensureFolder = async (
      name: string,
      key: string,
      parentId?: string,
    ) => {
      const existing = await prisma.fileObject.findFirst({
        where: { bucketId: bucket!.id, key },
      });
      if (!existing) {
        return prisma.fileObject.create({
          data: {
            name,
            key,
            isFolder: true,
            bucketId: bucket!.id,
            tenantId: tenant!.id,
            parentId,
          },
        });
      }
      return existing;
    };

    await ensureFolder("Documents", "documents/");
    await ensureFolder("Images", "images/");

    const readmeKey = "readme.txt";
    const readme = await prisma.fileObject.findFirst({
      where: { bucketId: bucket.id, key: readmeKey },
    });
    if (!readme) {
      await prisma.fileObject.create({
        data: {
          name: "readme.txt",
          key: readmeKey,
          size: 512,
          mimeType: "text/plain",
          bucketId: bucket.id,
          tenantId: tenant.id,
        },
      });
    }

    return NextResponse.json({
      message: "Seed check complete",
      tenantId: tenant.id,
      userEmail: user.email,
    });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json(
      { error: "Failed to seed database" },
      { status: 500 },
    );
  }
}
