import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Link2, Timer } from "lucide-react";
import { hasValidSessionCookie } from "@/lib/auth";
import { fetchJiraWorklogs } from "@/lib/jira";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { readAllWorklogs } from "@/lib/worklog-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  params: Promise<{ member: string }>;
};

function hourFormat(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

export default async function TeamMemberPage({ params }: Props) {
  const isAuthed = await hasValidSessionCookie();
  if (!isAuthed) {
    redirect("/login");
  }

  const { member: memberParam } = await params;
  const member = decodeURIComponent(memberParam);

  const entries = isSupabaseConfigured() ? await readAllWorklogs() : await fetchJiraWorklogs();
  const memberEntries = entries.filter((item) => item.author === member);

  if (memberEntries.length === 0) {
    notFound();
  }

  const jiraBrowseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/+$/, "");
  const totalHours = memberEntries.reduce((sum, item) => sum + item.seconds / 3600, 0);
  const activeDays = new Set(memberEntries.map((item) => new Date(item.started).toISOString().slice(0, 10))).size;
  const projects = [...new Set(memberEntries.map((item) => item.projectName))];
  const topIssuesMap = new Map<string, { summary: string; hours: number; project: string }>();

  for (const item of memberEntries) {
    const current = topIssuesMap.get(item.issueKey);
    topIssuesMap.set(item.issueKey, {
      summary: item.issueSummary,
      project: item.projectName,
      hours: (current?.hours ?? 0) + item.seconds / 3600,
    });
  }

  const topIssues = [...topIssuesMap.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 20);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#134e4a_0%,_#0f172a_42%,_#020617_100%)] p-8 text-slate-100">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
        <header className="rounded-2xl border border-slate-700/50 bg-slate-950/50 p-6">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-emerald-300">Team Drilldown</p>
          <h1 className="mt-2 text-4xl font-semibold">{member}</h1>
          <div className="mt-4 flex gap-3">
            <Button asChild variant="secondary">
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Link>
            </Button>
            <form action="/api/auth/logout" method="post">
              <Button variant="outline">Sign out</Button>
            </form>
          </div>
        </header>

        <section className="grid grid-cols-3 gap-4">
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                <Timer className="h-4 w-4 text-emerald-300" />
                Total Hours
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{hourFormat(totalHours)}</CardContent>
          </Card>
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-slate-300">Active Days</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{activeDays}</CardContent>
          </Card>
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-slate-300">Projects Involved</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{projects.length}</CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-1 border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {projects.map((project) => (
                <div key={project} className="rounded border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-sm">
                  {project}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="col-span-2 border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle>Top Issues</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded border border-slate-700/40">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-900/80 text-xs uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Issue</th>
                      <th className="px-3 py-2">Project</th>
                      <th className="px-3 py-2">Hours</th>
                      <th className="px-3 py-2">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topIssues.map((item) => (
                      <tr key={item.key} className="border-t border-slate-800/80">
                        <td className="px-3 py-2 font-mono text-xs text-emerald-200">
                          {jiraBrowseUrl ? (
                            <a
                              href={`${jiraBrowseUrl}/browse/${item.key}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 hover:text-emerald-100 hover:underline"
                            >
                              {item.key}
                              <Link2 className="h-3 w-3" />
                            </a>
                          ) : (
                            item.key
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-200">{item.project}</td>
                        <td className="px-3 py-2 text-slate-200">{hourFormat(item.hours)}</td>
                        <td className="truncate px-3 py-2 text-slate-300">{item.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
