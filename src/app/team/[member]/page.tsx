import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Link2, Timer } from "lucide-react";
import { hasValidSessionCookie } from "@/lib/auth";
import { fetchJiraWorklogs } from "@/lib/jira";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { readAllWorklogs, readContributorTargets } from "@/lib/worklog-store";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Props = {
  params: Promise<{ member: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function hourFormat(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getMonthBounds(monthIso: string): { start: Date; end: Date } {
  const [year, month] = monthIso.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end };
}

export default async function TeamMemberPage({ params, searchParams }: Props) {
  const isAuthed = await hasValidSessionCookie();
  if (!isAuthed) {
    redirect("/login");
  }

  const { member: memberParam } = await params;
  const member = decodeURIComponent(memberParam);
  const query = searchParams ? await searchParams : {};
  const month = typeof query.month === "string" ? query.month : new Date().toISOString().slice(0, 7);
  const targetStatus = typeof query.target === "string" ? query.target : "";

  const entries = isSupabaseConfigured() ? await readAllWorklogs() : await fetchJiraWorklogs();
  const memberEntries = entries.filter((item) => item.author === member);

  if (memberEntries.length === 0) {
    notFound();
  }

  const targets = isSupabaseConfigured() ? await readContributorTargets() : {};
  const targetHoursMonth = targets[member] ?? 160;
  const workingDays = 20;
  const dailyTarget = targetHoursMonth / workingDays;

  const jiraBrowseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/+$/, "");
  const totalHours = memberEntries.reduce((sum, item) => sum + item.seconds / 3600, 0);
  const activeDays = new Set(memberEntries.map((item) => new Date(item.started).toISOString().slice(0, 10))).size;
  const projects = [...new Set(memberEntries.map((item) => item.projectName))];
  const topIssuesMap = new Map<string, { summary: string; hours: number; project: string }>();
  const dayHours = new Map<string, number>();

  for (const item of memberEntries) {
    const current = topIssuesMap.get(item.issueKey);
    topIssuesMap.set(item.issueKey, {
      summary: item.issueSummary,
      project: item.projectName,
      hours: (current?.hours ?? 0) + item.seconds / 3600,
    });
    const key = dayKey(new Date(item.started));
    dayHours.set(key, (dayHours.get(key) ?? 0) + item.seconds / 3600);
  }

  const topIssues = [...topIssuesMap.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 20);

  const { start, end } = getMonthBounds(month);
  const monthTotal = [...dayHours.entries()]
    .filter(([key]) => {
      const d = new Date(`${key}T00:00:00`);
      return d >= start && d <= end;
    })
    .reduce((sum, [, hours]) => sum + hours, 0);
  const monthProgress = targetHoursMonth > 0 ? Math.min(monthTotal / targetHoursMonth, 1.5) : 0;

  const firstWeekdayMondayBased = (start.getDay() + 6) % 7;
  const daysInMonth = end.getDate();
  const calendarCells: Array<{ date: Date | null }> = [];

  for (let i = 0; i < firstWeekdayMondayBased; i += 1) {
    calendarCells.push({ date: null });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    calendarCells.push({ date: new Date(start.getFullYear(), start.getMonth(), d) });
  }
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push({ date: null });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#dcfce7_0%,_#f8fafc_40%,_#e2e8f0_100%)] p-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top,_#134e4a_0%,_#0f172a_42%,_#020617_100%)] dark:text-slate-100">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
        <header className="rounded-2xl border border-slate-300/80 bg-white/85 p-6 dark:border-slate-700/50 dark:bg-slate-950/50">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-300">Contributor Drilldown</p>
          <h1 className="mt-2 text-4xl font-semibold">{member}</h1>
          <div className="mt-4 flex flex-wrap gap-3">
            <ModeToggle />
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

        <section className="grid grid-cols-4 gap-4">
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <Timer className="h-4 w-4 text-emerald-300" />
                Total Hours
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{hourFormat(totalHours)}</CardContent>
          </Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-slate-700 dark:text-slate-300">Active Days</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{activeDays}</CardContent>
          </Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-slate-700 dark:text-slate-300">Monthly Target</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{hourFormat(targetHoursMonth)}</CardContent>
          </Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-slate-700 dark:text-slate-300">Month Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-3xl font-semibold">{hourFormat(monthTotal)}</div>
              <div className="h-2 overflow-hidden rounded bg-slate-300 dark:bg-slate-800">
                <div className="h-full bg-gradient-to-r from-emerald-300 via-cyan-300 to-indigo-300" style={{ width: `${Math.min(monthProgress * 100, 100)}%` }} />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-1 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle>Target Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {targetStatus === "ok" && (
                <p className="rounded border border-emerald-400/60 bg-emerald-100 px-3 py-2 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
                  Target updated.
                </p>
              )}
              {targetStatus === "invalid" && (
                <p className="rounded border border-rose-400/60 bg-rose-100 px-3 py-2 text-rose-900 dark:bg-rose-900/20 dark:text-rose-200">
                  Invalid target hours.
                </p>
              )}
              <form action="/api/targets" method="post" className="space-y-2">
                <input type="hidden" name="author" value={member} />
                <input type="hidden" name="redirectTo" value={`/team/${encodeURIComponent(member)}?month=${month}`} />
                <label className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">Monthly target hours</label>
                <Input name="targetHours" type="number" min={0} max={400} step="0.5" defaultValue={targetHoursMonth} />
                <Button type="submit" className="w-full">Save Target</Button>
              </form>
              <form method="get" className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">Calendar month</label>
                <Input name="month" type="month" defaultValue={month} />
                <Button type="submit" variant="outline" className="w-full">Load Month</Button>
              </form>
              <p className="text-xs text-slate-600 dark:text-slate-400">Daily target baseline: {hourFormat(dailyTarget)}</p>
            </CardContent>
          </Card>

          <Card className="col-span-2 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle>Worklog Calendar (Monday First)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-7 gap-2 text-center text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {calendarCells.map((cell, index) => {
                  if (!cell.date) {
                    return <div key={`empty-${index}`} className="h-20 rounded border border-dashed border-slate-300/60 dark:border-slate-700/40" />;
                  }
                  const key = dayKey(cell.date);
                  const hours = dayHours.get(key) ?? 0;
                  const ratio = dailyTarget > 0 ? Math.min(hours / dailyTarget, 1.5) : 0;
                  return (
                    <div key={key} className="h-20 rounded border border-slate-300 bg-slate-100/80 p-2 dark:border-slate-700 dark:bg-slate-900/50">
                      <div className="text-xs font-semibold">{cell.date.getDate()}</div>
                      <div className="mt-1 text-sm">{hourFormat(hours)}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-300 dark:bg-slate-800">
                        <div
                          className={`h-full ${ratio >= 1 ? "bg-emerald-400" : "bg-amber-400"}`}
                          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-1 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {projects.map((project) => (
                <div key={project} className="rounded border border-slate-300 bg-slate-100/80 px-3 py-2 text-sm dark:border-slate-700/60 dark:bg-slate-900/50">
                  {project}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="col-span-2 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle>Top Issues</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded border border-slate-300 dark:border-slate-700/40">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-200/90 text-xs uppercase tracking-widest text-slate-600 dark:bg-slate-900/80 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Issue</th>
                      <th className="px-3 py-2">Project</th>
                      <th className="px-3 py-2">Hours</th>
                      <th className="px-3 py-2">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topIssues.map((item) => (
                      <tr key={item.key} className="border-t border-slate-300 dark:border-slate-800/80">
                        <td className="px-3 py-2 font-mono text-xs text-emerald-700 dark:text-emerald-200">
                          {jiraBrowseUrl ? (
                            <a
                              href={`${jiraBrowseUrl}/browse/${item.key}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 hover:text-emerald-900 hover:underline dark:hover:text-emerald-100"
                            >
                              {item.key}
                              <Link2 className="h-3 w-3" />
                            </a>
                          ) : (
                            item.key
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{item.project}</td>
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{hourFormat(item.hours)}</td>
                        <td className="truncate px-3 py-2 text-slate-700 dark:text-slate-300">{item.summary}</td>
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
