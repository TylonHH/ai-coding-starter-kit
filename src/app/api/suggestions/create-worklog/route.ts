import { NextResponse } from "next/server";
import { hasValidSessionCookie } from "@/lib/auth";
import { createJiraWorklog, type WorklogEntry } from "@/lib/jira";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { upsertWorklogs } from "@/lib/worklog-store";

type Payload = {
  issueId: string;
  issueKey: string;
  issueSummary: string;
  projectKey: string;
  projectName: string;
  member: string;
  memberAccountId?: string;
  started: string;
  seconds: number;
  comment: string;
};

export async function POST(request: Request) {
  const isAuthed = await hasValidSessionCookie();
  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.issueKey || !body.issueId || !body.issueSummary || !body.projectKey || !body.projectName) {
    return NextResponse.json({ error: "Missing issue metadata" }, { status: 400 });
  }
  if (!body.member || typeof body.member !== "string") {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }
  if (!body.started || typeof body.started !== "string") {
    return NextResponse.json({ error: "Missing started datetime" }, { status: 400 });
  }
  if (!Number.isFinite(body.seconds) || body.seconds <= 0) {
    return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
  }

  try {
    const created = await createJiraWorklog({
      issueKey: body.issueKey,
      started: body.started,
      seconds: body.seconds,
      comment: body.comment,
    });

    if (isSupabaseConfigured()) {
      const row: WorklogEntry = {
        id: `${body.issueId}:${created.id}`,
        issueId: body.issueId,
        issueKey: body.issueKey,
        issueSummary: body.issueSummary,
        projectKey: body.projectKey,
        projectName: body.projectName,
        author: body.member,
        authorAccountId: body.memberAccountId ?? "unknown-account",
        teamNames: [],
        started: created.started,
        seconds: created.seconds,
        comment: created.comment || body.comment,
      };
      await upsertWorklogs([row]);
    }

    return NextResponse.json({
      created: {
        id: created.id,
        started: created.started,
        seconds: created.seconds,
        comment: created.comment || body.comment,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
