import { NextResponse } from "next/server";
import { hasValidSessionCookie } from "@/lib/auth";
import { fetchJiraWorklogs } from "@/lib/jira";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { upsertWorklogs } from "@/lib/worklog-store";

export async function POST(request: Request) {
  const isAuthed = await hasValidSessionCookie();
  if (!isAuthed) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/?sync=disabled", request.url));
  }

  try {
    const worklogs = await fetchJiraWorklogs();
    await upsertWorklogs(worklogs);
    const redirectUrl = new URL("/?sync=ok", request.url);
    redirectUrl.searchParams.set("syncAt", new Date().toISOString());
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const redirectUrl = new URL("/?sync=error", request.url);
    const message = error instanceof Error ? error.message : "Unknown sync error";
    redirectUrl.searchParams.set("syncMessage", message.slice(0, 220));
    return NextResponse.redirect(redirectUrl);
  }
}
