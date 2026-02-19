import { NextResponse } from "next/server";
import { hasValidSessionCookie } from "@/lib/auth";
import { generateWorklogSuggestions } from "@/lib/jira";

type Payload = {
  member: string;
  accountId?: string;
  date: string;
  projectKey?: string;
  existingIssueKeys?: string[];
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

  if (!body.member || typeof body.member !== "string") {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }
  if (!body.date || typeof body.date !== "string") {
    return NextResponse.json({ error: "Missing date" }, { status: 400 });
  }

  try {
    const suggestions = await generateWorklogSuggestions({
      memberName: body.member,
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      date: body.date,
      projectKey:
        typeof body.projectKey === "string" && body.projectKey !== "all" ? body.projectKey : undefined,
      existingIssueKeys: Array.isArray(body.existingIssueKeys)
        ? body.existingIssueKeys.filter((key): key is string => typeof key === "string")
        : [],
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
