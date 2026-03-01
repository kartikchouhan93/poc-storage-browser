import { NextResponse } from "next/server";
import { confirmForgotPassword } from "@/lib/auth-service";

export async function POST(request: Request) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json(
        { error: "Email, confirmation code, and new password are required" },
        { status: 400 },
      );
    }

    await confirmForgotPassword(email, code, newPassword);

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error: any) {
    console.error("Confirm password POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to reset password" },
      { status: 500 },
    );
  }
}
