import { NextResponse } from "next/server";
import { hasValidSessionCookie } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { upsertContributorTarget } from "@/lib/worklog-store";

export async function POST(request: Request) {
  const isAuthed = await hasValidSessionCookie();
  if (!isAuthed) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/?target=disabled", request.url));
  }

  const formData = await request.formData();
  const author = formData.get("author");
  const targetHours = formData.get("targetHours");
  const redirectTo = formData.get("redirectTo");

  if (typeof author !== "string" || !author.trim()) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const parsed = Number(targetHours);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 400) {
    const fallback = typeof redirectTo === "string" ? redirectTo : "/";
    return NextResponse.redirect(new URL(`${fallback}?target=invalid`, request.url));
  }

  await upsertContributorTarget(author, parsed);
  const base = typeof redirectTo === "string" ? redirectTo : "/";
  return NextResponse.redirect(new URL(`${base}?target=ok`, request.url));
}
