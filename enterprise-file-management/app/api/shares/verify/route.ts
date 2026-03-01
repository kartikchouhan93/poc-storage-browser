import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback_secret_for_development",
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (payload.purpose !== "magic_link") {
      throw new Error("Invalid token purpose");
    }

    const shareId = payload.shareId as string;

    // Generate an access session token (valid for e.g. 24 hours)
    const sessionToken = await new SignJWT({ shareId, access: true })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(JWT_SECRET);

    const response = NextResponse.redirect(
      new URL(`/file/share/${shareId}`, request.url),
    );

    response.cookies.set(`share_session_${shareId}`, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("OTP/Magic Link verification error:", error);
    return NextResponse.json(
      { error: "Invalid or expired link" },
      { status: 401 },
    );
  }
}
