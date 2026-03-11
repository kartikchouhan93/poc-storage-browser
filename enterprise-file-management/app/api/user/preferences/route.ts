import { NextResponse } from "next/server";

// Theme preferences are now managed exclusively via localStorage on the client.
// These endpoints are kept as no-ops for backwards compatibility.

export async function GET() {
  return NextResponse.json({ themeMode: 'light', themeColor: 'blue', themeFont: 'inter', themeRadius: '0.3' });
}

export async function PATCH() {
  return NextResponse.json({ ok: true });
}
