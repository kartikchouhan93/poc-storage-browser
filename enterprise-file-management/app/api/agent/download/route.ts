import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import fs from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "assets", "porter");

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const manifestPath = path.join(ASSETS_DIR, "manifest.json");
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    return NextResponse.json(manifest);
  } catch {
    return NextResponse.json({ error: "Manifest not found" }, { status: 404 });
  }
}

export async function HEAD(request: NextRequest) {
  // Used by download links to check file existence
  const { searchParams } = request.nextUrl;
  const filename = searchParams.get("file");
  if (!filename || filename.includes("..")) {
    return new NextResponse(null, { status: 400 });
  }

  const filePath = path.join(ASSETS_DIR, filename);
  if (!fs.existsSync(filePath)) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, { status: 200 });
}
