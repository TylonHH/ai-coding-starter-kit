import { NextResponse } from "next/server";
import { hasValidSessionCookie } from "@/lib/auth";
import { generateWorklogSuggestions, getJiraCurrentUser } from "@/lib/jira";

type Payload = {
  member: string;
  accountId?: string;
  date: string;
  projectKey?: string;
  existingIssueKeys?: string[];
  mode?: "fallback" | "ai";
  aiSystemPrompt?: string;
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
    const currentUser = await getJiraCurrentUser();
    const expectedName = currentUser.displayName.trim().toLowerCase();
    const expectedEmail = currentUser.emailAddress.trim().toLowerCase();
    const expectedAccountId = currentUser.accountId.trim();
    const requestedMember = body.member.trim().toLowerCase();
    const requestedMemberAccountId = (typeof body.accountId === "string" ? body.accountId : "").trim();

    const memberMatchesName = expectedName.length > 0 && requestedMember === expectedName;
    const memberMatchesEmail = expectedEmail.length > 0 && requestedMember === expectedEmail;
    const memberMatchesAccountId =
      expectedAccountId.length > 0 &&
      requestedMemberAccountId.length > 0 &&
      requestedMemberAccountId === expectedAccountId;

    if (!memberMatchesName && !memberMatchesEmail && !memberMatchesAccountId) {
      return NextResponse.json(
        {
          error:
            "Suggestion generation is restricted: only the Jira API user can generate own worklog suggestions.",
        },
        { status: 403 }
      );
    }

    const suggestions = await generateWorklogSuggestions({
      memberName: body.member,
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      date: body.date,
      projectKey:
        typeof body.projectKey === "string" && body.projectKey !== "all" ? body.projectKey : undefined,
      existingIssueKeys: Array.isArray(body.existingIssueKeys)
        ? body.existingIssueKeys.filter((key): key is string => typeof key === "string")
        : [],
      mode: body.mode === "ai" ? "ai" : "fallback",
      aiSystemPrompt: typeof body.aiSystemPrompt === "string" ? body.aiSystemPrompt : undefined,
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
