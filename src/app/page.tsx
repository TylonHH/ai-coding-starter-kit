import Link from "next/link";
import { redirect } from "next/navigation";
import { hasValidSessionCookie } from "@/lib/auth";
import { fetchJiraWorklogs, type WorklogEntry } from "@/lib/jira";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { readAllWorklogs, upsertWorklogs } from "@/lib/worklog-store";
import { WorklogDashboard } from "@/components/worklog-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: Props) {
  const isAuthed = await hasValidSessionCookie();
  if (!isAuthed) {
    redirect("/login");
  }

  try {
    const params = searchParams ? await searchParams : {};
    const syncStatus = typeof params.sync === "string" ? params.sync : undefined;
    const dbEnabled = isSupabaseConfigured();
    let entries: WorklogEntry[] = [];

    if (dbEnabled) {
      entries = await readAllWorklogs();
      if (entries.length === 0) {
        const fresh = await fetchJiraWorklogs();
        await upsertWorklogs(fresh);
        entries = fresh;
      }
    } else {
      entries = await fetchJiraWorklogs();
    }

    const jiraBrowseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/+$/, "");

    if (entries.length === 0) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
          <Card className="w-full max-w-xl border-slate-700 bg-slate-900/60">
            <CardHeader>
              <CardTitle>No worklogs returned from Jira</CardTitle>
              <CardDescription>
                The connection is working, but the query returned zero records.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-300">
              <p>Set `JIRA_JQL` in your `.env.local` to broaden the search scope.</p>
              <form action="/api/auth/logout" method="post">
                <Button variant="secondary">Sign out</Button>
              </form>
            </CardContent>
          </Card>
        </main>
      );
    }

    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-200 lg:hidden">
          <Card className="max-w-md border-slate-700 bg-slate-900/80">
            <CardHeader>
              <CardTitle>Desktop-only POC</CardTitle>
              <CardDescription>Open this dashboard on desktop (minimum 1024px width).</CardDescription>
            </CardHeader>
            <CardContent>
              <form action="/api/auth/logout" method="post">
                <Button variant="secondary">Sign out</Button>
              </form>
            </CardContent>
          </Card>
        </div>
        <WorklogDashboard
          entries={entries}
          jiraBrowseUrl={jiraBrowseUrl}
          syncEnabled={dbEnabled}
          syncStatus={syncStatus}
        />
      </>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <Card className="w-full max-w-2xl border-rose-700/70 bg-slate-900/60">
          <CardHeader>
            <CardTitle>Jira connection error</CardTitle>
            <CardDescription>
              Check your credentials in `.env.local` and verify API permissions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="overflow-auto rounded-md bg-black/40 p-3 text-xs text-rose-200">{message}</pre>
            <div className="flex gap-3">
              <Button asChild variant="secondary">
                <Link href="/login">Back to login</Link>
              </Button>
              <form action="/api/auth/logout" method="post">
                <Button variant="outline">Clear session</Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }
}
