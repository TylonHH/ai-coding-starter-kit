import { NextResponse } from "next/server";
import { createSessionToken, isValidAppPassword, SESSION } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const password = formData.get("password");

    if (typeof password !== "string" || !password) {
      return NextResponse.redirect(new URL("/login?error=invalid_credentials", request.url));
    }

    const isValid = isValidAppPassword(password);
    if (!isValid) {
      return NextResponse.redirect(new URL("/login?error=invalid_credentials", request.url));
    }

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(SESSION.name, createSessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION.maxAge,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=server_misconfigured", request.url));
  }
}
