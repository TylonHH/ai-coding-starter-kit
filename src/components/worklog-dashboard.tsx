"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Filter, Link2, ListChecks, Save, Timer, Trash2, Users } from "lucide-react";
import type { WorklogEntry } from "@/lib/jira";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DatePreset = "30d" | "90d" | "ytd" | "all";
type SummaryMode = "executive" | "delivery" | "team";

type Preset = {
  name: string;
  datePreset: DatePreset;
  project: string;
  author: string;
  search: string;
  summaryMode: SummaryMode;
};

type Props = {
  entries: WorklogEntry[];
  jiraBrowseUrl: string;
  syncEnabled: boolean;
  syncStatus?: string;
};

const PRESET_STORAGE_KEY = "jira-worklog-presets-v1";

function hourFormat(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clampPreset(datePreset: DatePreset): Date | null {
  const now = new Date();
  if (datePreset === "all") {
    return null;
  }
  if (datePreset === "30d") {
    now.setDate(now.getDate() - 30);
    return now;
  }
  if (datePreset === "90d") {
    now.setDate(now.getDate() - 90);
    return now;
  }
  return new Date(now.getFullYear(), 0, 1);
}

function buildTrendPoints(entries: WorklogEntry[]) {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const day = toDayKey(new Date(entry.started));
    byDay.set(day, (byDay.get(day) ?? 0) + entry.seconds / 3600);
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, hours]) => ({ day, hours }));
}

function buildHeatmap(entries: WorklogEntry[]) {
  const weekdayLabel = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets = new Map<string, number>();

  for (const entry of entries) {
    const date = new Date(entry.started);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const weekKey = toDayKey(monday);
    const key = `${weekKey}:${date.getDay()}`;
    buckets.set(key, (buckets.get(key) ?? 0) + entry.seconds / 3600);
  }

  const weekKeys = [...new Set([...buckets.keys()].map((key) => key.split(":")[0]))].sort();
  const last12 = weekKeys.slice(-12);
  return last12.map((week) => ({
    week,
    values: weekdayLabel.map((_, day) => buckets.get(`${week}:${day}`) ?? 0),
  }));
}

function polylinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }

  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - (value / max) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

export function WorklogDashboard({ entries, jiraBrowseUrl, syncEnabled, syncStatus }: Props) {
  const [datePreset, setDatePreset] = useState<DatePreset>("90d");
  const [project, setProject] = useState("all");
  const [author, setAuthor] = useState("all");
  const [search, setSearch] = useState("");
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("executive");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("none");
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Preset[];
      if (Array.isArray(parsed)) {
        setPresets(parsed);
      }
    } catch {
      setPresets([]);
    }
  }, []);

  function persistPreset(nextPresets: Preset[]) {
    setPresets(nextPresets);
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(nextPresets));
  }

  function saveCurrentPreset() {
    const finalName = presetName.trim();
    if (!finalName) {
      return;
    }
    const nextPreset: Preset = {
      name: finalName,
      datePreset,
      project,
      author,
      search,
      summaryMode,
    };
    const nextPresets = [nextPreset, ...presets.filter((item) => item.name !== finalName)].slice(0, 12);
    persistPreset(nextPresets);
    setSelectedPreset(finalName);
    setPresetName("");
  }

  function applyPreset(name: string) {
    if (name === "none") {
      setSelectedPreset("none");
      return;
    }
    const target = presets.find((item) => item.name === name);
    if (!target) {
      return;
    }
    setDatePreset(target.datePreset);
    setProject(target.project);
    setAuthor(target.author);
    setSearch(target.search);
    setSummaryMode(target.summaryMode);
    setSelectedPreset(name);
  }

  function deleteSelectedPreset() {
    if (selectedPreset === "none") {
      return;
    }
    const nextPresets = presets.filter((item) => item.name !== selectedPreset);
    persistPreset(nextPresets);
    setSelectedPreset("none");
  }

  const projects = useMemo(
    () => ["all", ...new Set(entries.map((item) => item.projectName))],
    [entries]
  );
  const authors = useMemo(
    () => ["all", ...new Set(entries.map((item) => item.author))],
    [entries]
  );

  const filtered = useMemo(() => {
    const since = clampPreset(datePreset);
    const normalizedSearch = search.trim().toLowerCase();

    return entries.filter((item) => {
      const started = new Date(item.started);
      if (since && started < since) {
        return false;
      }
      if (project !== "all" && item.projectName !== project) {
        return false;
      }
      if (author !== "all" && item.author !== author) {
        return false;
      }
      if (
        normalizedSearch &&
        !`${item.issueKey} ${item.issueSummary}`.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }
      return true;
    });
  }, [author, datePreset, entries, project, search]);

  const metrics = useMemo(() => {
    const totalHours = filtered.reduce((sum, item) => sum + item.seconds / 3600, 0);
    const days = new Set(filtered.map((item) => toDayKey(new Date(item.started))));
    const issueCount = new Set(filtered.map((item) => item.issueKey)).size;
    const avgDaily = days.size > 0 ? totalHours / days.size : 0;
    return {
      totalHours,
      activeDays: days.size,
      issueCount,
      avgDaily,
    };
  }, [filtered]);

  const topProjects = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) {
      map.set(item.projectName, (map.get(item.projectName) ?? 0) + item.seconds / 3600);
    }
    return [...map.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 8);
  }, [filtered]);

  const topAuthors = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) {
      map.set(item.author, (map.get(item.author) ?? 0) + item.seconds / 3600);
    }
    return [...map.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 8);
  }, [filtered]);

  const teamMembers = useMemo(
    () => [...new Set(entries.map((item) => item.author))].sort((a, b) => a.localeCompare(b)),
    [entries]
  );

  const topIssues = useMemo(() => {
    const map = new Map<string, { summary: string; hours: number; project: string }>();
    for (const item of filtered) {
      const current = map.get(item.issueKey);
      const hours = item.seconds / 3600;
      map.set(item.issueKey, {
        summary: item.issueSummary,
        project: item.projectName,
        hours: (current?.hours ?? 0) + hours,
      });
    }
    return [...map.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 12);
  }, [filtered]);

  const trend = useMemo(() => buildTrendPoints(filtered), [filtered]);
  const heatmap = useMemo(() => buildHeatmap(filtered), [filtered]);
  const trendPath = useMemo(
    () => polylinePath(trend.map((t) => t.hours), 760, 160),
    [trend]
  );

  const strongestProject = topProjects[0]?.name ?? "n/a";
  const strongestAuthor = topAuthors[0]?.name ?? "n/a";

  return (
    <div className="hidden min-h-screen bg-[radial-gradient(circle_at_top_right,_#2a3f57_0%,_#111827_45%,_#05070b_100%)] p-8 text-slate-100 lg:block">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <header className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl border border-slate-700/50 bg-slate-950/40 p-6 shadow-2xl backdrop-blur">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-amber-300">
              Jira Worklog Command Deck
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Operations Intelligence Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Explore logged effort by timeline, project, contributor, and ticket. Use filters to generate quick
              executive, delivery, or team-focused summaries.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {syncEnabled && (
              <form action="/api/sync" method="post">
                <Button variant="outline" className="border border-emerald-500/60 text-emerald-200 hover:bg-emerald-900/20">
                  Sync Jira Now
                </Button>
              </form>
            )}
            <form action="/api/auth/logout" method="post">
              <Button variant="secondary" className="border border-slate-600 bg-slate-900/50 hover:bg-slate-800">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        {syncStatus === "ok" && (
          <div className="rounded border border-emerald-500/40 bg-emerald-900/20 px-4 py-2 text-sm text-emerald-200">
            Jira sync completed successfully.
          </div>
        )}
        {syncStatus === "error" && (
          <div className="rounded border border-rose-500/40 bg-rose-900/20 px-4 py-2 text-sm text-rose-200">
            Jira sync failed. Check Jira credentials and permissions.
          </div>
        )}
        {syncStatus === "disabled" && (
          <div className="rounded border border-amber-500/40 bg-amber-900/20 px-4 py-2 text-sm text-amber-200">
            Sync endpoint is disabled because Supabase is not configured.
          </div>
        )}

        <Card className="border-slate-700/50 bg-slate-950/30">
          <CardContent className="grid grid-cols-6 items-end gap-4 p-5">
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-400">Range</p>
              <Tabs
                value={datePreset}
                onValueChange={(value) => setDatePreset(value as DatePreset)}
                className="w-full"
              >
                <TabsList className="grid h-10 w-full grid-cols-4 bg-slate-900">
                  <TabsTrigger value="30d">30d</TabsTrigger>
                  <TabsTrigger value="90d">90d</TabsTrigger>
                  <TabsTrigger value="ytd">YTD</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-400">Project</p>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-400">Contributor</p>
              <Select value={author} onValueChange={setAuthor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {authors.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-400">Ticket search</p>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="PROJ-123 or summary keyword..."
              />
            </div>
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-400">Summary mode</p>
              <Select value={summaryMode} onValueChange={(value) => setSummaryMode(value as SummaryMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="executive">Executive</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700/50 bg-slate-950/30">
          <CardContent className="grid grid-cols-7 items-end gap-4 p-5">
            <div className="col-span-2">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-400">Preset name</p>
              <Input
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="e.g. Delivery-Q1"
              />
            </div>
            <div className="col-span-1">
              <Button
                type="button"
                onClick={saveCurrentPreset}
                className="w-full bg-emerald-300 text-black hover:bg-emerald-200"
              >
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
            </div>
            <div className="col-span-2">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-400">Saved presets</p>
              <Select value={selectedPreset} onValueChange={applyPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="Select preset..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {presets.map((item) => (
                    <SelectItem key={item.name} value={item.name}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <Button type="button" variant="outline" onClick={deleteSelectedPreset} className="w-full">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>
            <div className="col-span-1 text-right text-xs text-slate-400">
              Presets are stored in local browser storage.
            </div>
          </CardContent>
        </Card>

        <section className="grid grid-cols-4 gap-4">
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                <Timer className="h-4 w-4 text-amber-300" />
                Total Hours
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{hourFormat(metrics.totalHours)}</CardContent>
          </Card>
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                <CalendarDays className="h-4 w-4 text-cyan-300" />
                Active Days
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{metrics.activeDays}</CardContent>
          </Card>
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                <ListChecks className="h-4 w-4 text-emerald-300" />
                Tickets Touched
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{metrics.issueCount}</CardContent>
          </Card>
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-300">
                <BarChart3 className="h-4 w-4 text-fuchsia-300" />
                Avg / Active Day
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{hourFormat(metrics.avgDaily)}</CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-2 border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle>Worklog Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-4">
                <svg viewBox="0 0 760 190" className="w-full">
                  <defs>
                    <linearGradient id="trendLine" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#fcd34d" stopOpacity="0.15" />
                    </linearGradient>
                  </defs>
                  <polyline
                    points={trendPath}
                    fill="none"
                    stroke="url(#trendLine)"
                    strokeWidth="3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Showing {trend.length} tracked day(s). Peak project: <strong>{strongestProject}</strong>.
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle>Smart Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-200">
              {summaryMode === "executive" && (
                <>
                  <p>
                    {hourFormat(metrics.totalHours)} across {metrics.issueCount} tickets. The largest effort center is{" "}
                    <strong>{strongestProject}</strong>.
                  </p>
                  <p>
                    Daily throughput sits at <strong>{hourFormat(metrics.avgDaily)}</strong> over {metrics.activeDays}{" "}
                    active days.
                  </p>
                </>
              )}
              {summaryMode === "delivery" && (
                <>
                  <p>
                    Delivery weight is concentrated in <strong>{topProjects[0]?.name ?? "n/a"}</strong>, then{" "}
                    <strong>{topProjects[1]?.name ?? "n/a"}</strong>.
                  </p>
                  <p>
                    Highest-ticket effort: <strong>{topIssues[0]?.key ?? "n/a"}</strong> ({hourFormat(
                      topIssues[0]?.hours ?? 0
                    )}).
                  </p>
                </>
              )}
              {summaryMode === "team" && (
                <>
                  <p>
                    Top contributor: <strong>{strongestAuthor}</strong> with{" "}
                    <strong>{hourFormat(topAuthors[0]?.hours ?? 0)}</strong>.
                  </p>
                  <p>
                    Contributor spread: {topAuthors.length} visible team members in the selected filter scope.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-amber-300" />
                Project Distribution
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topProjects.map((item) => {
                const width = (item.hours / Math.max(topProjects[0]?.hours ?? 1, 1)) * 100;
                return (
                  <div key={item.name}>
                    <div className="mb-1 flex justify-between text-xs text-slate-300">
                      <span>{item.name}</span>
                      <span>{hourFormat(item.hours)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-cyan-300" />
                Contributor Ranking
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topAuthors.map((item, index) => {
                const width = (item.hours / Math.max(topAuthors[0]?.hours ?? 1, 1)) * 100;
                return (
                  <div key={item.name}>
                    <div className="mb-1 flex justify-between text-xs text-slate-300">
                      <Link
                        href={`/team/${encodeURIComponent(item.name)}`}
                        className="hover:text-cyan-200 hover:underline"
                      >
                        #{index + 1} {item.name}
                      </Link>
                      <span>{hourFormat(item.hours)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-2 border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle>High-Effort Issues</CardTitle>
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
                        <td className="px-3 py-2 font-mono text-xs text-amber-200">
                          {jiraBrowseUrl ? (
                            <a
                              className="inline-flex items-center gap-1 hover:text-amber-100 hover:underline"
                              href={`${jiraBrowseUrl}/browse/${item.key}`}
                              target="_blank"
                              rel="noreferrer noopener"
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

          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle>Weekday Heatmap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-slate-400">
                  <span>Sun</span>
                  <span>Mon</span>
                  <span>Tue</span>
                  <span>Wed</span>
                  <span>Thu</span>
                  <span>Fri</span>
                  <span>Sat</span>
                </div>
                {heatmap.map((week) => (
                  <div key={week.week} className="grid grid-cols-7 gap-1">
                    {week.values.map((hours, index) => {
                      const intensity = Math.min(hours / 8, 1);
                      return (
                        <div
                          key={`${week.week}-${index}`}
                          title={`${week.week} day ${index}: ${hourFormat(hours)}`}
                          className="h-5 rounded"
                          style={{
                            backgroundColor: `rgba(34, 211, 238, ${0.12 + intensity * 0.78})`,
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1">
          <Card className="border-slate-700/50 bg-slate-950/40">
            <CardHeader>
              <CardTitle>Team Drilldown (from Jira worklog authors)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {teamMembers.map((member) => (
                <Link
                  key={member}
                  href={`/team/${encodeURIComponent(member)}`}
                  className="rounded-full border border-slate-600 bg-slate-900/50 px-3 py-1 text-sm hover:bg-slate-800"
                >
                  {member}
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
