import { NextResponse } from "next/server";
import { forgotPassword } from "@/lib/auth-service";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    await forgotPassword(email);

    return NextResponse.json({
      success: true,
      message: "Password reset code sent",
    });
  } catch (error: any) {
    console.error("Forgot password POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to initiate password reset" },
      { status: 500 },
    );
  }
}
