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
    return NextResponse.redirect(new URL("/?sync=ok", request.url));
  } catch {
    return NextResponse.redirect(new URL("/?sync=error", request.url));
  }
}
