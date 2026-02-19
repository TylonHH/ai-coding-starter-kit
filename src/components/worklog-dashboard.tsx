"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Filter, Link2, ListChecks, Timer, Users } from "lucide-react";
import type { WorklogEntry } from "@/lib/jira";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DatePreset = "last7" | "last30" | "lastWeek" | "lastMonth" | "ytd" | "all" | "custom";
type SummaryMode = "executive" | "delivery" | "team";

type DashboardState = {
  datePreset: DatePreset;
  startDate: string;
  endDate: string;
  projectKey: string;
  team: string;
  author: string;
  search: string;
  summaryMode: SummaryMode;
  excludeWeekends: boolean;
};

type Props = {
  entries: WorklogEntry[];
  contributorTargets: Record<string, number>;
  jiraBrowseUrl: string;
  syncEnabled: boolean;
  syncStatus?: string;
  syncMessage?: string;
  syncAt?: string;
  viewerStorageKey: string;
};

function hourFormat(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

function normalizeAuthorKey(value: string): string {
  return value.trim().toLowerCase();
}

function firstNameSortKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const [first, ...rest] = trimmed.split(/\s+/);
  return `${first.toLowerCase()} ${rest.join(" ").toLowerCase()}`.trim();
}

function formatDayEu(dayIso: string): string {
  const date = new Date(`${dayIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dayIso;
  }
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function formatSyncDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toInputDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function daysBetweenInclusive(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.floor(diff / 86400000) + 1;
}

function getPresetRange(preset: DatePreset): { start: Date | null; end: Date | null } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  if (preset === "all") {
    return { start: null, end: null };
  }
  if (preset === "last7") {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 6);
    return { start, end: todayEnd };
  }
  if (preset === "last30") {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 29);
    return { start, end: todayEnd };
  }
  if (preset === "lastWeek") {
    const day = todayStart.getDay();
    const mondayOffset = (day + 6) % 7;
    const thisWeekMonday = new Date(todayStart);
    thisWeekMonday.setDate(thisWeekMonday.getDate() - mondayOffset);
    const lastWeekMonday = new Date(thisWeekMonday);
    lastWeekMonday.setDate(lastWeekMonday.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekMonday);
    return { start: lastWeekMonday, end: lastWeekEnd };
  }
  if (preset === "lastMonth") {
    const start = new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1);
    const end = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    return { start, end };
  }
  if (preset === "ytd") {
    const start = new Date(todayStart.getFullYear(), 0, 1);
    return { start, end: todayEnd };
  }
  return { start: null, end: null };
}

function buildTrendPoints(
  entries: WorklogEntry[],
  startBound: Date | null,
  endBoundInclusive: Date | null,
  excludeWeekends: boolean
) {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const day = toDayKey(new Date(entry.started));
    byDay.set(day, (byDay.get(day) ?? 0) + entry.seconds / 3600);
  }

  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;

  if (startBound && endBoundInclusive) {
    rangeStart = new Date(startBound.getFullYear(), startBound.getMonth(), startBound.getDate());
    rangeEnd = new Date(
      endBoundInclusive.getFullYear(),
      endBoundInclusive.getMonth(),
      endBoundInclusive.getDate()
    );
  } else if (entries.length > 0) {
    const sorted = entries
      .map((entry) => new Date(entry.started))
      .filter((value) => !Number.isNaN(value.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    if (min && max) {
      rangeStart = new Date(min.getFullYear(), min.getMonth(), min.getDate());
      rangeEnd = new Date(max.getFullYear(), max.getMonth(), max.getDate());
    }
  }

  if (!rangeStart || !rangeEnd) {
    return [];
  }

  const points: Array<{ day: string; hours: number }> = [];
  const cursor = new Date(rangeStart);
  while (cursor.getTime() <= rangeEnd.getTime()) {
    const dayOfWeek = cursor.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (!excludeWeekends || !isWeekend) {
      const day = toDayKey(cursor);
      points.push({
        day,
        hours: byDay.get(day) ?? 0,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

function buildHeatmap(entries: WorklogEntry[]) {
  const weekdayLabel = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const buckets = new Map<string, number>();

  for (const entry of entries) {
    const date = new Date(entry.started);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const weekKey = toDayKey(monday);
    const dayIndexMondayFirst = (date.getDay() + 6) % 7;
    const key = `${weekKey}:${dayIndexMondayFirst}`;
    buckets.set(key, (buckets.get(key) ?? 0) + entry.seconds / 3600);
  }

  const weekKeys = [...new Set([...buckets.keys()].map((key) => key.split(":")[0]))].sort();
  const last12 = weekKeys.slice(-12);
  return {
    labels: weekdayLabel,
    rows: last12.map((week) => ({
      week,
      values: weekdayLabel.map((_, day) => buckets.get(`${week}:${day}`) ?? 0),
    })),
  };
}

function polylinePath(
  values: number[],
  maxOverride?: number,
  left = 40,
  right = 740,
  top = 20,
  bottom = 170
): string {
  if (values.length === 0) {
    return "";
  }

  const max = maxOverride ?? Math.max(...values, 1);
  const width = right - left;
  const height = bottom - top;
  return values
    .map((value, index) => {
      const x = left + (index / Math.max(values.length - 1, 1)) * width;
      const y = bottom - (value / max) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

export function WorklogDashboard({
  entries,
  contributorTargets,
  jiraBrowseUrl,
  syncEnabled,
  syncStatus,
  syncMessage,
  syncAt,
  viewerStorageKey,
}: Props) {
  const [datePreset, setDatePreset] = useState<DatePreset>("last30");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projectKey, setProjectKey] = useState("all");
  const [team, setTeam] = useState("all");
  const [author, setAuthor] = useState("all");
  const [search, setSearch] = useState("");
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("executive");
  const [excludeWeekends, setExcludeWeekends] = useState(false);
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [selectedTrendDay, setSelectedTrendDay] = useState<string | null>(null);
  const [isStateLoaded, setIsStateLoaded] = useState(false);
  const [latestSyncAt, setLatestSyncAt] = useState<string>("");

  const dashboardStateStorageKey = `jira-worklog-dashboard-state-v1-${viewerStorageKey}`;
  const latestSyncStorageKey = `jira-worklog-last-sync-v1-${viewerStorageKey}`;

  useEffect(() => {
    if (!isStateLoaded) {
      return;
    }
    const { start, end } = getPresetRange(datePreset);
    if (start && end) {
      setStartDate(toInputDate(start));
      setEndDate(toInputDate(new Date(end.getTime() - 1)));
    } else if (datePreset !== "custom") {
      setStartDate("");
      setEndDate("");
    }
  }, [datePreset, isStateLoaded]);

  useEffect(() => {
    try {
      const rawState = localStorage.getItem(dashboardStateStorageKey);
      if (rawState) {
        const parsed = JSON.parse(rawState) as Partial<DashboardState>;
        if (parsed.datePreset && ["last7", "last30", "lastWeek", "lastMonth", "ytd", "all", "custom"].includes(parsed.datePreset)) {
          setDatePreset(parsed.datePreset as DatePreset);
        }
        if (typeof parsed.startDate === "string") {
          setStartDate(parsed.startDate);
        }
        if (typeof parsed.endDate === "string") {
          setEndDate(parsed.endDate);
        }
        if (typeof parsed.projectKey === "string" && parsed.projectKey.trim()) {
          setProjectKey(parsed.projectKey);
        }
        if (typeof parsed.team === "string" && parsed.team.trim()) {
          setTeam(parsed.team);
        }
        if (typeof parsed.author === "string" && parsed.author.trim()) {
          setAuthor(parsed.author);
        }
        if (typeof parsed.search === "string") {
          setSearch(parsed.search);
        }
        if (parsed.summaryMode && ["executive", "delivery", "team"].includes(parsed.summaryMode)) {
          setSummaryMode(parsed.summaryMode as SummaryMode);
        }
        if (typeof parsed.excludeWeekends === "boolean") {
          setExcludeWeekends(parsed.excludeWeekends);
        }
      }

      const storedSync = localStorage.getItem(latestSyncStorageKey);
      if (storedSync && storedSync.trim()) {
        setLatestSyncAt(storedSync);
      }

      if (syncAt && syncAt.trim()) {
        localStorage.setItem(latestSyncStorageKey, syncAt);
        setLatestSyncAt(syncAt);
      }
    } catch {
      setLatestSyncAt(syncAt ?? "");
    } finally {
      setIsStateLoaded(true);
    }
  }, [dashboardStateStorageKey, latestSyncStorageKey, syncAt]);

  useEffect(() => {
    if (!isStateLoaded) {
      return;
    }
    const payload: DashboardState = {
      datePreset,
      startDate,
      endDate,
      projectKey,
      team,
      author,
      search,
      summaryMode,
      excludeWeekends,
    };
    try {
      localStorage.setItem(dashboardStateStorageKey, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [author, dashboardStateStorageKey, datePreset, endDate, excludeWeekends, isStateLoaded, projectKey, search, startDate, summaryMode, team]);

  useEffect(() => {
    if (!isStateLoaded) {
      return;
    }
    if (!syncAt || !syncAt.trim()) {
      return;
    }
    try {
      localStorage.setItem(latestSyncStorageKey, syncAt);
    } catch {
      // ignore storage errors
    }
    setLatestSyncAt(syncAt);
  }, [isStateLoaded, latestSyncStorageKey, syncAt]);

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of entries) {
      map.set(item.projectKey, item.projectName);
    }
    return [
      { key: "all", label: "All Projects" },
      ...[...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, name]) => ({ key, label: `${key} - ${name}` })),
    ];
  }, [entries]);
  const authors = useMemo(
    () => ["all", ...[...new Set(entries.map((item) => item.author))].sort((a, b) => firstNameSortKey(a).localeCompare(firstNameSortKey(b)))],
    [entries]
  );
  const teams = useMemo(
    () =>
      ["all", ...[...new Set(entries.flatMap((item) => item.teamNames).filter((name) => name.trim()))].sort((a, b) => a.localeCompare(b))],
    [entries]
  );

  const bounds = useMemo(() => {
    let startBound: Date | null = null;
    let endBoundInclusive: Date | null = null;
    if (datePreset === "custom" && startDate && endDate) {
      startBound = new Date(`${startDate}T00:00:00`);
      endBoundInclusive = new Date(`${endDate}T23:59:59.999`);
    } else if (datePreset !== "custom") {
      const { start, end } = getPresetRange(datePreset);
      startBound = start;
      endBoundInclusive = end ? new Date(end.getTime() - 1) : null;
    }
    return { startBound, endBoundInclusive };
  }, [datePreset, endDate, startDate]);

  const filtered = useMemo(() => {
    const { startBound, endBoundInclusive } = bounds;
    const normalizedSearch = search.trim().toLowerCase();

    return entries.filter((item) => {
      const started = new Date(item.started);
      if (startBound && started < startBound) {
        return false;
      }
      if (endBoundInclusive && started > endBoundInclusive) {
        return false;
      }
      if (projectKey !== "all" && item.projectKey !== projectKey) {
        return false;
      }
      if (team !== "all" && !item.teamNames.includes(team)) {
        return false;
      }
      if (author !== "all" && item.author !== author) {
        return false;
      }
      if (
        normalizedSearch &&
        !`${item.issueKey} ${item.issueSummary} ${item.comment}`.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }
      return true;
    });
  }, [author, bounds, entries, projectKey, search, team]);

  const metrics = useMemo(() => {
    const totalHours = filtered.reduce((sum, item) => sum + item.seconds / 3600, 0);
    const days = new Set(filtered.map((item) => toDayKey(new Date(item.started))));
    const issueCount = new Set(filtered.map((item) => item.issueKey)).size;
    const avgDaily = days.size > 0 ? totalHours / days.size : 0;
    let scopedDays = days.size;
    if (bounds.startBound && bounds.endBoundInclusive) {
      scopedDays = Math.max(1, daysBetweenInclusive(bounds.startBound, bounds.endBoundInclusive));
    }
    const normalizedTargets = new Map(
      Object.entries(contributorTargets).map(([name, hours]) => [normalizeAuthorKey(name), hours])
    );
    const activeAuthors = [...new Set(filtered.map((item) => item.author))];
    const dailyTargetHours = activeAuthors.reduce(
      (sum, name) => sum + (contributorTargets[name] ?? normalizedTargets.get(normalizeAuthorKey(name)) ?? 0),
      0
    );
    const targetHours = dailyTargetHours * scopedDays;
    return {
      totalHours,
      activeDays: days.size,
      issueCount,
      avgDaily,
      scopedDays,
      dailyTargetHours,
      targetHours,
    };
  }, [bounds, contributorTargets, filtered]);

  const topProjects = useMemo(() => {
    const map = new Map<string, { key: string; name: string; hours: number }>();
    for (const item of filtered) {
      const current = map.get(item.projectKey);
      map.set(item.projectKey, {
        key: item.projectKey,
        name: item.projectName,
        hours: (current?.hours ?? 0) + item.seconds / 3600,
      });
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours).slice(0, 8);
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

  const topIssues = useMemo(() => {
    const map = new Map<string, { summary: string; hours: number; project: string }>();
    for (const item of filtered) {
      const current = map.get(item.issueKey);
      const hours = item.seconds / 3600;
      map.set(item.issueKey, {
        summary: item.issueSummary,
        project: `${item.projectKey} - ${item.projectName}`,
        hours: (current?.hours ?? 0) + hours,
      });
    }
    return [...map.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 20);
  }, [filtered]);

  const issueWorklogs = useMemo(() => {
    if (!selectedIssueKey) {
      return [];
    }
    return filtered.filter((entry) => entry.issueKey === selectedIssueKey).sort((a, b) => b.started.localeCompare(a.started));
  }, [filtered, selectedIssueKey]);

  const issueContributorSlices = useMemo(() => {
    const byAuthor = new Map<string, number>();
    for (const log of issueWorklogs) {
      byAuthor.set(log.author, (byAuthor.get(log.author) ?? 0) + log.seconds / 3600);
    }
    const colors = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];
    const entries = [...byAuthor.entries()];
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    let offset = 0;
    return entries.map(([name, value], i) => {
      const pct = total > 0 ? (value / total) * 100 : 0;
      const start = offset;
      offset += pct;
      return { name, value, color: colors[i % colors.length], start, end: offset };
    });
  }, [issueWorklogs]);

  const issueConicGradient = useMemo(() => {
    if (issueContributorSlices.length === 0) {
      return "conic-gradient(#cbd5e1 0% 100%)";
    }
    const stops = issueContributorSlices
      .map((slice) => `${slice.color} ${slice.start}% ${slice.end}%`)
      .join(", ");
    return `conic-gradient(${stops})`;
  }, [issueContributorSlices]);

  const trend = useMemo(
    () => buildTrendPoints(filtered, bounds.startBound, bounds.endBoundInclusive, excludeWeekends),
    [bounds.endBoundInclusive, bounds.startBound, excludeWeekends, filtered]
  );
  const heatmap = useMemo(() => buildHeatmap(filtered), [filtered]);
  const trendMax = useMemo(
    () => Math.max(1, ...trend.map((t) => t.hours), metrics.dailyTargetHours),
    [metrics.dailyTargetHours, trend]
  );
  const trendPath = useMemo(() => polylinePath(trend.map((t) => t.hours), trendMax), [trend, trendMax]);
  const trendTargetPath = useMemo(
    () => polylinePath(trend.map(() => metrics.dailyTargetHours), trendMax),
    [metrics.dailyTargetHours, trend, trendMax]
  );
  const trendPoints = useMemo(
    () =>
      trend.map((point, index) => ({
        day: point.day,
        hours: point.hours,
        x: 40 + (index / Math.max(trend.length - 1, 1)) * 700,
        y: 170 - (point.hours / trendMax) * 150,
      })),
    [trend, trendMax]
  );
  const trendTickStep = useMemo(() => {
    if (trend.length <= 20) {
      return 1;
    }
    return Math.ceil(trend.length / 12);
  }, [trend.length]);

  useEffect(() => {
    if (!selectedTrendDay) {
      return;
    }
    if (!trend.some((point) => point.day === selectedTrendDay)) {
      setSelectedTrendDay(null);
    }
  }, [selectedTrendDay, trend]);

  const selectedTrendEntries = useMemo(
    () =>
      selectedTrendDay
        ? filtered.filter((entry) => toDayKey(new Date(entry.started)) === selectedTrendDay)
        : [],
    [filtered, selectedTrendDay]
  );
  const selectedTrendTotal = useMemo(
    () => selectedTrendEntries.reduce((sum, entry) => sum + entry.seconds / 3600, 0),
    [selectedTrendEntries]
  );
  const selectedTrendByAuthor = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of selectedTrendEntries) {
      map.set(entry.author, (map.get(entry.author) ?? 0) + entry.seconds / 3600);
    }
    return [...map.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [selectedTrendEntries]);
  const selectedTrendByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of selectedTrendEntries) {
      const key = `${entry.projectKey} - ${entry.projectName}`;
      map.set(key, (map.get(key) ?? 0) + entry.seconds / 3600);
    }
    return [...map.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [selectedTrendEntries]);
  const selectedTrendByIssue = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of selectedTrendEntries) {
      const key = `${entry.issueKey} - ${entry.issueSummary}`;
      map.set(key, (map.get(key) ?? 0) + entry.seconds / 3600);
    }
    return [...map.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 12);
  }, [selectedTrendEntries]);

  const strongestProject = topProjects[0] ? `${topProjects[0].key} - ${topProjects[0].name}` : "n/a";
  const strongestAuthor = topAuthors[0]?.name ?? "n/a";

  if (!isStateLoaded) {
    return (
      <div className="hidden min-h-screen bg-[radial-gradient(circle_at_top_right,_#f8fafc_0%,_#e2e8f0_48%,_#cbd5e1_100%)] p-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top_right,_#2a3f57_0%,_#111827_45%,_#05070b_100%)] dark:text-slate-100 lg:block">
        <div className="mx-auto max-w-[1440px]">
          <Card className="border-slate-300/80 bg-white/85 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardContent className="p-6 text-sm text-slate-700 dark:text-slate-300">Loading your saved dashboard settings...</CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden min-h-screen bg-[radial-gradient(circle_at_top_right,_#f8fafc_0%,_#e2e8f0_48%,_#cbd5e1_100%)] p-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top_right,_#2a3f57_0%,_#111827_45%,_#05070b_100%)] dark:text-slate-100 lg:block">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <header className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl border border-slate-300/80 bg-white/85 p-6 shadow-2xl backdrop-blur dark:border-slate-700/50 dark:bg-slate-950/40">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-amber-700 dark:text-amber-300">Jira Worklog Command Deck</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Operations Intelligence Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-700 dark:text-slate-300">Filter by teams, contributors, projects, and custom date windows. Click any ticket to inspect full worklog text details.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <ModeToggle />
              {syncEnabled && (
                <form action="/api/sync" method="post">
                  <Button variant="outline" className="border border-emerald-500/60 text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/20">Sync Jira Now</Button>
                </form>
              )}
              <form action="/api/auth/logout" method="post">
                <Button variant="secondary" className="border border-slate-400 bg-slate-100/80 text-slate-900 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-100 dark:hover:bg-slate-800">Sign out</Button>
              </form>
            </div>
            {syncEnabled && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Latest sync: {latestSyncAt ? formatSyncDateTime(latestSyncAt) : "not synced yet"}
              </p>
            )}
          </div>
        </header>

        {syncStatus === "ok" && <div className="rounded border border-emerald-500/40 bg-emerald-100/80 px-4 py-2 text-sm text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">Jira sync completed successfully.</div>}
        {syncStatus === "error" && <div className="rounded border border-rose-500/40 bg-rose-100/80 px-4 py-2 text-sm text-rose-900 dark:bg-rose-900/20 dark:text-rose-200">Jira sync failed. {syncMessage ? `${syncMessage}` : "Check Jira credentials, API permissions, and DB schema."}</div>}

        <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/30">
          <CardContent className="grid grid-cols-8 items-end gap-4 p-5">
            <div className="col-span-2">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-600 dark:text-slate-400">Quick Range</p>
              <Tabs value={datePreset} onValueChange={(value) => setDatePreset(value as DatePreset)} className="w-full">
                <TabsList className="grid h-10 w-full grid-cols-6 bg-slate-200 dark:bg-slate-900">
                  <TabsTrigger value="lastWeek">LW</TabsTrigger>
                  <TabsTrigger value="last7">7d</TabsTrigger>
                  <TabsTrigger value="last30">30d</TabsTrigger>
                  <TabsTrigger value="lastMonth">LM</TabsTrigger>
                  <TabsTrigger value="ytd">YTD</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="col-span-2">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-600 dark:text-slate-400">Custom Date Range</p>
              <div className="flex gap-2">
                <Input type="date" value={startDate} onChange={(event) => {
                  setDatePreset("custom");
                  setStartDate(event.target.value);
                }} />
                <Input type="date" value={endDate} onChange={(event) => {
                  setDatePreset("custom");
                  setEndDate(event.target.value);
                }} />
              </div>
            </div>
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-600 dark:text-slate-400">Team</p>
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{teams.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-600 dark:text-slate-400">Project</p>
              <Select value={projectKey} onValueChange={setProjectKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projects.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-600 dark:text-slate-400">Contributor</p>
              <Select value={author} onValueChange={setAuthor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{authors.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-600 dark:text-slate-400">Summary Mode</p>
              <Select value={summaryMode} onValueChange={(value) => setSummaryMode(value as SummaryMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="executive">Executive</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-8">
              <p className="mb-2 text-xs uppercase tracking-widest text-slate-600 dark:text-slate-400">Search</p>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issue key, summary, or worklog text..." />
            </div>
          </CardContent>
        </Card>

        <section className="grid grid-cols-5 gap-4">
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><Timer className="h-4 w-4 text-amber-500 dark:text-amber-300" />Total Hours</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{hourFormat(metrics.totalHours)}</CardContent></Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><CalendarDays className="h-4 w-4 text-cyan-500 dark:text-cyan-300" />Days In Scope</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{metrics.scopedDays}</CardContent></Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><ListChecks className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />Tickets Touched</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{metrics.issueCount}</CardContent></Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><BarChart3 className="h-4 w-4 text-fuchsia-500 dark:text-fuchsia-300" />Daily Target Sum</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{hourFormat(metrics.dailyTargetHours)}</CardContent></Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><BarChart3 className="h-4 w-4 text-indigo-500 dark:text-indigo-300" />Target vs Actual</CardTitle></CardHeader><CardContent className="space-y-1"><div className="text-xl font-semibold">{hourFormat(metrics.totalHours)} / {hourFormat(metrics.targetHours)}</div><div className="h-2 overflow-hidden rounded bg-slate-300 dark:bg-slate-800"><div className="h-full bg-gradient-to-r from-indigo-300 via-cyan-300 to-emerald-300" style={{ width: `${metrics.targetHours > 0 ? Math.min((metrics.totalHours / metrics.targetHours) * 100, 100) : 0}%` }} /></div></CardContent></Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-2 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle>Worklog Timeline</CardTitle>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <Checkbox
                    checked={excludeWeekends}
                    onCheckedChange={(checked) => setExcludeWeekends(Boolean(checked))}
                  />
                  Exclude weekends
                </label>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-slate-300 bg-slate-100/90 p-4 dark:border-slate-700/40 dark:bg-slate-900/40">
                <svg viewBox="0 0 760 220" className="w-full">
                  <defs>
                    <linearGradient id="trendLine" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.15" />
                    </linearGradient>
                  </defs>
                  <line x1="40" y1="170" x2="740" y2="170" stroke="currentColor" opacity="0.35" />
                  <line x1="40" y1="20" x2="40" y2="170" stroke="currentColor" opacity="0.35" />
                  <text x="34" y="170" textAnchor="end" fontSize="10" fill="currentColor">0</text>
                  <text x="34" y="95" textAnchor="end" fontSize="10" fill="currentColor">{(trendMax / 2).toFixed(1)}</text>
                  <text x="34" y="20" textAnchor="end" fontSize="10" fill="currentColor">{trendMax.toFixed(1)}</text>
                  {trendPoints
                    .filter((_, index) => index % trendTickStep === 0 || index === trendPoints.length - 1)
                    .map((point) => (
                      <text key={`x-${point.day}`} x={point.x} y={188} textAnchor="middle" fontSize="9" fill="currentColor">
                        {formatDayEu(point.day)}
                      </text>
                    ))}
                  <polyline points={trendPath} fill="none" stroke="url(#trendLine)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  <polyline points={trendTargetPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
                  {trendPoints.map((point) => (
                    <g key={point.day}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={selectedTrendDay === point.day ? 4 : 2.8}
                        fill={selectedTrendDay === point.day ? "#0ea5e9" : "#f59e0b"}
                        className="cursor-pointer"
                        onClick={() => setSelectedTrendDay(point.day)}
                      >
                        <title>{`${formatDayEu(point.day)}: ${hourFormat(point.hours)}`}</title>
                      </circle>
                    </g>
                  ))}
                </svg>
              </div>
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                Orange = actual, green dashed = summed daily targets. Zero-days are included in the selected range. Hover points for hours, click points for day details. Peak project: <strong>{strongestProject}</strong>.
              </p>
            </CardContent>
          </Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40">
            <CardHeader><CardTitle>Smart Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-800 dark:text-slate-200">
              {summaryMode === "executive" && <><p>{hourFormat(metrics.totalHours)} across {metrics.issueCount} tickets. Largest effort center: <strong>{strongestProject}</strong>.</p><p>Target comparison: <strong>{hourFormat(metrics.totalHours)}</strong> actual vs <strong>{hourFormat(metrics.targetHours)}</strong> target.</p></>}
              {summaryMode === "delivery" && <><p>Delivery concentration: <strong>{topProjects[0] ? `${topProjects[0].key} - ${topProjects[0].name}` : "n/a"}</strong>, then <strong>{topProjects[1] ? `${topProjects[1].key} - ${topProjects[1].name}` : "n/a"}</strong>.</p><p>Highest ticket effort: <strong>{topIssues[0]?.key ?? "n/a"}</strong> ({hourFormat(topIssues[0]?.hours ?? 0)}).</p></>}
              {summaryMode === "team" && <><p>Top contributor: <strong>{strongestAuthor}</strong> with <strong>{hourFormat(topAuthors[0]?.hours ?? 0)}</strong>.</p><p>Team filter: {team === "all" ? "All teams" : team}</p></>}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader><CardTitle className="flex items-center gap-2"><Filter className="h-4 w-4 text-amber-500 dark:text-amber-300" />Project Distribution</CardTitle></CardHeader><CardContent className="space-y-2">{topProjects.map((item) => {const width = (item.hours / Math.max(topProjects[0]?.hours ?? 1, 1)) * 100; return <div key={item.key}><div className="mb-1 flex justify-between text-xs text-slate-700 dark:text-slate-300"><span>{item.key} - {item.name}</span><span>{hourFormat(item.hours)}</span></div><div className="h-2 overflow-hidden rounded bg-slate-300 dark:bg-slate-800"><div className="h-full bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300" style={{ width: `${width}%` }} /></div></div>;})}</CardContent></Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-cyan-500 dark:text-cyan-300" />Contributor Ranking</CardTitle></CardHeader><CardContent className="space-y-2">{topAuthors.map((item, index) => {const width = (item.hours / Math.max(topAuthors[0]?.hours ?? 1, 1)) * 100; return <div key={item.name}><div className="mb-1 flex justify-between text-xs text-slate-700 dark:text-slate-300"><Link href={`/team/${encodeURIComponent(item.name)}`} className="hover:text-cyan-800 hover:underline dark:hover:text-cyan-200">#{index + 1} {item.name}</Link><span>{hourFormat(item.hours)}</span></div><div className="h-2 overflow-hidden rounded bg-slate-300 dark:bg-slate-800"><div className="h-full bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300" style={{ width: `${width}%` }} /></div></div>;})}</CardContent></Card>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-2 border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader><CardTitle>High-Effort Issues (click for details)</CardTitle></CardHeader><CardContent><div className="overflow-hidden rounded border border-slate-300 dark:border-slate-700/40"><table className="w-full text-left text-sm"><thead className="bg-slate-200/90 text-xs uppercase tracking-widest text-slate-600 dark:bg-slate-900/80 dark:text-slate-400"><tr><th className="px-3 py-2">Issue</th><th className="px-3 py-2">Project</th><th className="px-3 py-2">Hours</th><th className="px-3 py-2">Summary</th></tr></thead><tbody>{topIssues.map((item) => <tr key={item.key} className="cursor-pointer border-t border-slate-300 hover:bg-slate-100 dark:border-slate-800/80 dark:hover:bg-slate-900/50" onClick={() => setSelectedIssueKey(item.key)}><td className="px-3 py-2 font-mono text-xs text-amber-700 dark:text-amber-200">{jiraBrowseUrl ? <a className="inline-flex items-center gap-1 hover:text-amber-900 hover:underline dark:hover:text-amber-100" href={`${jiraBrowseUrl}/browse/${item.key}`} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>{item.key}<Link2 className="h-3 w-3" /></a> : item.key}</td><td className="px-3 py-2 text-slate-800 dark:text-slate-200">{item.project}</td><td className="px-3 py-2 text-slate-800 dark:text-slate-200">{hourFormat(item.hours)}</td><td className="truncate px-3 py-2 text-slate-700 dark:text-slate-300">{item.summary}</td></tr>)}</tbody></table></div></CardContent></Card>
          <Card className="border-slate-300/80 bg-white/80 dark:border-slate-700/50 dark:bg-slate-950/40"><CardHeader><CardTitle>Weekday Heatmap (rows = weeks)</CardTitle></CardHeader><CardContent><div className="space-y-2"><p className="text-xs text-slate-600 dark:text-slate-400">Each row is one calendar week (starting Monday). Darker cells mean more logged hours on that weekday.</p><div className="grid grid-cols-[5rem_repeat(7,minmax(0,1fr))] gap-1 text-center text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400"><span className="text-left">Week</span>{heatmap.labels.map((label) => <span key={label}>{label}</span>)}</div>{heatmap.rows.map((week) => <div key={week.week} className="grid grid-cols-[5rem_repeat(7,minmax(0,1fr))] gap-1"><span className="my-auto text-left text-[10px] text-slate-600 dark:text-slate-400">{week.week.slice(5)}</span>{week.values.map((hours, index) => {const intensity = Math.min(hours / 8, 1); return <div key={`${week.week}-${index}`} title={`Week ${week.week}, ${heatmap.labels[index]}: ${hourFormat(hours)}`} className="h-5 rounded" style={{ backgroundColor: `rgba(34, 211, 238, ${0.12 + intensity * 0.78})` }} />;})}</div>)}</div></CardContent></Card>
        </section>
      </div>

      <Dialog open={Boolean(selectedIssueKey)} onOpenChange={(open) => (!open ? setSelectedIssueKey(null) : undefined)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Issue Details: {selectedIssueKey}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-4">
            <Card className="col-span-1 border-slate-300 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="text-base">Contributors</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="mx-auto h-44 w-44 rounded-full" style={{ background: issueConicGradient }} />
                <div className="space-y-1 text-xs">
                  {issueContributorSlices.map((slice) => (
                    <div key={slice.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: slice.color }} />
                        {slice.name}
                      </span>
                      <span>{hourFormat(slice.value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="col-span-2 border-slate-300 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="text-base">All Logs & Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded border p-2">Entries: <strong>{issueWorklogs.length}</strong></div>
                  <div className="rounded border p-2">
                    Total: <strong>{hourFormat(issueWorklogs.reduce((s, e) => s + e.seconds / 3600, 0))}</strong>
                  </div>
                  <div className="rounded border p-2">
                    Contributors: <strong>{new Set(issueWorklogs.map((e) => e.author)).size}</strong>
                  </div>
                </div>
                <div className="max-h-[42vh] space-y-2 overflow-auto">
                  {issueWorklogs.map((entry) => (
                    <div key={entry.id} className="rounded border border-slate-300 bg-slate-100/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50">
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>{new Date(entry.started).toLocaleString()}</span>
                        <span>{entry.author}</span>
                        <span>{hourFormat(entry.seconds / 3600)}</span>
                      </div>
                      <p className="text-slate-800 dark:text-slate-200">{entry.comment || "(Kein Worklog-Text vorhanden oder noch nicht synchronisiert)"}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedTrendDay)} onOpenChange={(open) => (!open ? setSelectedTrendDay(null) : undefined)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Day Details: {selectedTrendDay ? formatDayEu(selectedTrendDay) : ""}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-4">
            <Card className="border-slate-300 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="text-base">By Contributor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-slate-600 dark:text-slate-400">Total day hours: <strong>{hourFormat(selectedTrendTotal)}</strong></p>
                {selectedTrendByAuthor.map((item) => {
                  const width = (item.hours / Math.max(selectedTrendByAuthor[0]?.hours ?? 1, 1)) * 100;
                  return (
                    <div key={item.name}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span>{item.name}</span>
                        <span>{hourFormat(item.hours)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-slate-300 dark:bg-slate-800">
                        <div className="h-full bg-cyan-400" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="border-slate-300 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="text-base">By Project</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedTrendByProject.map((item) => {
                  const width = (item.hours / Math.max(selectedTrendByProject[0]?.hours ?? 1, 1)) * 100;
                  return (
                    <div key={item.name}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span>{item.name}</span>
                        <span>{hourFormat(item.hours)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-slate-300 dark:bg-slate-800">
                        <div className="h-full bg-amber-400" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="border-slate-300 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="text-base">Top Tasks</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[56vh] space-y-2 overflow-auto">
                {selectedTrendByIssue.map((item) => (
                  <div key={item.name} className="rounded border border-slate-300 bg-slate-100/80 p-2 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="mb-1 font-medium">{item.name}</div>
                    <div className="text-slate-600 dark:text-slate-400">{hourFormat(item.hours)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


