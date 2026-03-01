import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { sendMagicLinkEmail } from "@/lib/sns";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback_secret_for_development",
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> | { shareId: string } },
) {
  try {
    const { shareId } = await params;
    const body = await request.json();
    const { email, password } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const share = await prisma.share.findUnique({
      where: { id: shareId },
    });

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    if (share.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Share is not active" },
        { status: 403 },
      );
    }

    if (share.toEmail !== email.toLowerCase().trim()) {
      return NextResponse.json(
        { error: "Invalid email for this share" },
        { status: 403 },
      );
    }

    if (share.passwordProtected) {
      if (!password) {
        return NextResponse.json(
          { error: "Password is required" },
          { status: 400 },
        );
      }
      const match = await bcrypt.compare(
        password,
        share.passwordHash as string,
      );
      if (!match) {
        return NextResponse.json(
          { error: "Invalid password" },
          { status: 401 },
        );
      }
    }

    // Generate Magic Link token
    const token = await new SignJWT({
      shareId: share.id,
      email: share.toEmail,
      purpose: "magic_link",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m") // magic link valid for 15 minutes
      .sign(JWT_SECRET);

    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("host") || "localhost:3000";
    const magicLinkUrl = `${protocol}://${host}/api/shares/verify?token=${token}`;

    await sendMagicLinkEmail({ toEmail: share.toEmail, magicLinkUrl });

    return NextResponse.json({ message: "Magic link sent to your email" });
  } catch (error) {
    console.error("Failed to authenticate share:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 },
    );
  }
}
