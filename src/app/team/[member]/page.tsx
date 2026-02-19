import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Link2, Timer } from "lucide-react";
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

function normalizeAuthorKey(value: string): string {
  return value.trim().toLowerCase();
}

function getMonthBounds(monthIso: string): { start: Date; end: Date } {
  const [year, month] = monthIso.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end };
}

function shiftMonth(monthIso: string, delta: number): string {
  const [year, month] = monthIso.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return date.toISOString().slice(0, 7);
}

function countWeekdays(start: Date, end: Date): number {
  const current = new Date(start);
  let count = 0;
  while (current <= end) {
    const day = current.getDay();
    if (day >= 1 && day <= 5) {
      count += 1;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function buildMemberHref(
  member: string,
  opts: { month: string; project?: string; day?: string; issue?: string }
): string {
  const params = new URLSearchParams();
  params.set("month", opts.month);
  if (opts.project && opts.project !== "all") {
    params.set("project", opts.project);
  }
  if (opts.day) {
    params.set("day", opts.day);
  }
  if (opts.issue) {
    params.set("issue", opts.issue);
  }
  return `/team/${encodeURIComponent(member)}?${params.toString()}`;
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
  const projectParam = typeof query.project === "string" ? query.project : "all";
  const selectedDay = typeof query.day === "string" ? query.day : "";
  const selectedIssue = typeof query.issue === "string" ? query.issue : "";
  const targetStatus = typeof query.target === "string" ? query.target : "";
  const targetMessage = typeof query.targetMessage === "string" ? query.targetMessage : "";

  const entries = isSupabaseConfigured() ? await readAllWorklogs() : await fetchJiraWorklogs();
  const memberEntries = entries.filter((item) => item.author === member);
  if (memberEntries.length === 0) {
    notFound();
  }

  const targets = isSupabaseConfigured() ? await readContributorTargets() : {};
  const normalizedTargetMap = new Map(
    Object.entries(targets).map(([name, hours]) => [normalizeAuthorKey(name), hours])
  );
  const dailyTarget = targets[member] ?? normalizedTargetMap.get(normalizeAuthorKey(member)) ?? 8;

  const { start, end } = getMonthBounds(month);
  const inSelectedMonth = (isoDate: string) => {
    const d = new Date(isoDate);
    return d >= start && d <= end;
  };

  const monthEntries = memberEntries.filter((item) => inSelectedMonth(item.started));

  const projectMap = new Map<string, { key: string; name: string; hours: number }>();
  for (const item of monthEntries) {
    const current = projectMap.get(item.projectKey);
    projectMap.set(item.projectKey, {
      key: item.projectKey,
      name: item.projectName,
      hours: (current?.hours ?? 0) + item.seconds / 3600,
    });
  }
  const projects = [...projectMap.values()].sort((a, b) => b.hours - a.hours);
  const activeProject = projectParam === "all" || projectMap.has(projectParam) ? projectParam : "all";

  const scopedEntries =
    activeProject === "all" ? monthEntries : monthEntries.filter((item) => item.projectKey === activeProject);

  const jiraBrowseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/+$/, "");
  const totalHours = scopedEntries.reduce((sum, item) => sum + item.seconds / 3600, 0);
  const activeDays = new Set(scopedEntries.map((item) => dayKey(new Date(item.started)))).size;

  const topIssuesMap = new Map<string, { summary: string; hours: number; project: string; projectKey: string }>();
  const dayHours = new Map<string, number>();
  for (const item of scopedEntries) {
    const current = topIssuesMap.get(item.issueKey);
    topIssuesMap.set(item.issueKey, {
      summary: item.issueSummary,
      project: item.projectName,
      projectKey: item.projectKey,
      hours: (current?.hours ?? 0) + item.seconds / 3600,
    });
    const key = dayKey(new Date(item.started));
    dayHours.set(key, (dayHours.get(key) ?? 0) + item.seconds / 3600);
  }
  const topIssues = [...topIssuesMap.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 20);

  const weekdaysInMonth = countWeekdays(start, end);
  const targetHoursMonth = dailyTarget * weekdaysInMonth;
  const monthTotal = totalHours;
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

  const selectedDayLogs = selectedDay
    ? scopedEntries
        .filter((item) => dayKey(new Date(item.started)) === selectedDay)
        .sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime())
    : [];

  const selectedIssueLogs = selectedIssue
    ? entries
        .filter(
          (item) =>
            item.issueKey === selectedIssue &&
            inSelectedMonth(item.started) &&
            (activeProject === "all" || item.projectKey === activeProject)
        )
        .sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime())
    : [];

  const selectedIssueHours = selectedIssueLogs.reduce((sum, item) => sum + item.seconds / 3600, 0);
  const selectedIssueMemberHours = selectedIssueLogs
    .filter((item) => item.author === member)
    .reduce((sum, item) => sum + item.seconds / 3600, 0);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#dcfce7_0%,_#f8fafc_40%,_#e2e8f0_100%)] p-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top,_#134e4a_0%,_#0f172a_42%,_#020617_100%)] dark:text-slate-100">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
        <header className="rounded-2xl border border-slate-300/80 bg-white/85 p-6 dark:border-slate-700/50 dark:bg-slate-950/50">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-300">Contributor Drilldown</p>
          <h1 className="mt-2 text-4xl font-semibold">{member}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-3">
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
            <div className="ml-auto flex items-center gap-2">
              <Button asChild variant="outline" size="icon">
                <Link href={buildMemberHref(member, { month: shiftMonth(month, -1), project: activeProject })}>
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              </Button>
              <form method="get" className="flex items-center gap-2">
                <Input name="month" type="month" defaultValue={month} className="w-44" />
                {activeProject !== "all" && <input type="hidden" name="project" value={activeProject} />}
                <Button type="submit" variant="outline">Go</Button>
              </form>
              <Button asChild variant="outline" size="icon">
                <Link href={buildMemberHref(member, { month: shiftMonth(month, 1), project: activeProject })}>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-4 gap-4">
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <Timer className="h-4 w-4 text-emerald-300" />
                Total Hours (Selection)
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{hourFormat(totalHours)}</CardContent>
          </Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-slate-700 dark:text-slate-300">Active Days (Selection)</CardTitle>
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
              {targetStatus === "error" && (
                <p className="rounded border border-rose-400/60 bg-rose-100 px-3 py-2 text-rose-900 dark:bg-rose-900/20 dark:text-rose-200">
                  Could not save target to DB.
                  {targetMessage ? ` ${targetMessage}` : ""}
                </p>
              )}
              <form action="/api/targets" method="post" className="space-y-2">
                <input type="hidden" name="author" value={member} />
                <input
                  type="hidden"
                  name="redirectTo"
                  value={buildMemberHref(member, {
                    month,
                    project: activeProject,
                    day: selectedDay || undefined,
                    issue: selectedIssue || undefined,
                  })}
                />
                <label className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">Daily target hours</label>
                <Input name="targetHours" type="number" min={0} max={24} step="0.25" defaultValue={dailyTarget} />
                <Button type="submit" className="w-full">Save Target</Button>
              </form>
              <p className="text-xs text-slate-600 dark:text-slate-400">Month target (calculated): {hourFormat(targetHoursMonth)}</p>
            </CardContent>
          </Card>

          <Card className="col-span-2 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle>Worklog Calendar (click a date)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                  const isSelected = selectedDay === key;
                  return (
                    <Link
                      key={key}
                      href={buildMemberHref(member, { month, project: activeProject, day: key })}
                      className={`h-20 rounded border p-2 transition ${isSelected ? "border-cyan-500 bg-cyan-100/70 dark:border-cyan-400 dark:bg-cyan-900/20" : "border-slate-300 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-900/50"}`}
                    >
                      <div className="text-xs font-semibold">{cell.date.getDate()}</div>
                      <div className="mt-1 text-sm">{hourFormat(hours)}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-300 dark:bg-slate-800">
                        <div
                          className={`h-full ${ratio >= 1 ? "bg-emerald-400" : "bg-amber-400"}`}
                          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
              {selectedDay && (
                <div className="rounded border border-slate-300 bg-slate-100/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold">Worklogs on {selectedDay}</p>
                    <Button asChild variant="outline" size="sm">
                      <Link href={buildMemberHref(member, { month, project: activeProject })}>Clear</Link>
                    </Button>
                  </div>
                  {selectedDayLogs.length === 0 ? (
                    <p className="text-slate-700 dark:text-slate-300">No worklogs for this date.</p>
                  ) : (
                    <div className="max-h-60 space-y-2 overflow-auto">
                      {selectedDayLogs.map((entry) => (
                        <div key={entry.id} className="rounded border border-slate-300 bg-white/70 p-2 dark:border-slate-700 dark:bg-slate-950/40">
                          <div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                            <span>{new Date(entry.started).toLocaleTimeString()}</span>
                            <span>{hourFormat(entry.seconds / 3600)}</span>
                            <span>{entry.issueKey}</span>
                          </div>
                          <p className="text-slate-800 dark:text-slate-200">{entry.comment || "(No worklog text provided)"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-1 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle>Projects (selected month)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href={buildMemberHref(member, { month })}
                className={`block rounded border px-3 py-2 text-sm ${activeProject === "all" ? "border-cyan-500 bg-cyan-100/70 text-cyan-900 dark:border-cyan-400 dark:bg-cyan-900/20 dark:text-cyan-100" : "border-slate-300 bg-slate-100/80 dark:border-slate-700/60 dark:bg-slate-900/50"}`}
              >
                All Projects
              </Link>
              {projects.map((project) => (
                <Link
                  key={project.key}
                  href={buildMemberHref(member, { month, project: project.key })}
                  className={`block rounded border px-3 py-2 text-sm ${activeProject === project.key ? "border-cyan-500 bg-cyan-100/70 text-cyan-900 dark:border-cyan-400 dark:bg-cyan-900/20 dark:text-cyan-100" : "border-slate-300 bg-slate-100/80 dark:border-slate-700/60 dark:bg-slate-900/50"}`}
                >
                  <div className="flex items-center justify-between">
                    <span>{project.key} - {project.name}</span>
                    <span className="font-semibold">{hourFormat(project.hours)}</span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="col-span-2 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle>Top Issues From Selected Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                          <div className="flex items-center gap-2">
                            <Link
                              href={buildMemberHref(member, { month, project: activeProject, issue: item.key })}
                              className="hover:text-emerald-900 hover:underline dark:hover:text-emerald-100"
                            >
                              {item.key}
                            </Link>
                            {jiraBrowseUrl && (
                              <a
                                href={`${jiraBrowseUrl}/browse/${item.key}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                              >
                                <Link2 className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{item.projectKey} - {item.project}</td>
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{hourFormat(item.hours)}</td>
                        <td className="truncate px-3 py-2 text-slate-700 dark:text-slate-300">{item.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedIssue && (
                <div className="rounded border border-slate-300 bg-slate-100/80 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold">Issue Worklogs: {selectedIssue}</p>
                    <Button asChild variant="outline" size="sm">
                      <Link href={buildMemberHref(member, { month, project: activeProject })}>Clear</Link>
                    </Button>
                  </div>
                  <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
                    Total issue hours: {hourFormat(selectedIssueHours)}. Your contribution: {hourFormat(selectedIssueMemberHours)}.
                  </p>
                  {selectedIssueLogs.length === 0 ? (
                    <p className="text-sm text-slate-700 dark:text-slate-300">No worklogs found for this issue in the selected period.</p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-auto">
                      {selectedIssueLogs.map((entry) => {
                        const highlighted = entry.author === member;
                        return (
                          <div
                            key={entry.id}
                            className={`rounded border p-2 text-sm ${highlighted ? "border-emerald-500 bg-emerald-100/80 dark:border-emerald-400 dark:bg-emerald-900/20" : "border-slate-300 bg-white/70 dark:border-slate-700 dark:bg-slate-950/40"}`}
                          >
                            <div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                              <span>{new Date(entry.started).toLocaleString()}</span>
                              <span>{entry.author}{highlighted ? " (You)" : ""}</span>
                              <span>{hourFormat(entry.seconds / 3600)}</span>
                            </div>
                            <p className="text-slate-800 dark:text-slate-200">{entry.comment || "(No worklog text provided)"}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
