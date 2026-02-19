"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Suggestion = {
  id: string;
  issueId: string;
  issueKey: string;
  issueSummary: string;
  projectKey: string;
  projectName: string;
  started: string;
  seconds: number;
  comment: string;
  changedFields: string[];
  changeSummary: string;
};

type EditableSuggestion = Suggestion & {
  startedInput: string;
  hoursInput: string;
  isSaving: boolean;
  error: string;
};

type Props = {
  member: string;
  memberAccountId: string;
  date: string;
  projectKey: string;
  existingIssueKeys: string[];
  jiraBrowseUrl: string;
};

function toLocalInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function toIsoFromLocalInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function toHoursString(seconds: number): string {
  return (seconds / 3600).toFixed(2).replace(/\.00$/, "");
}

export function WorklogSuggestionPanel({
  member,
  memberAccountId,
  date,
  projectKey,
  existingIssueKeys,
  jiraBrowseUrl,
}: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [rows, setRows] = useState<EditableSuggestion[]>([]);

  const existingIssueKeysSet = useMemo(() => new Set(existingIssueKeys), [existingIssueKeys]);

  async function generateSuggestions() {
    setIsGenerating(true);
    setGenerateError("");
    try {
      const response = await fetch("/api/suggestions/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          member,
          accountId: memberAccountId || undefined,
          date,
          projectKey,
          existingIssueKeys: [...existingIssueKeysSet],
        }),
      });
      const payload = (await response.json()) as { suggestions?: Suggestion[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextRows = (payload.suggestions ?? []).map((item) => ({
        ...item,
        startedInput: toLocalInputValue(item.started),
        hoursInput: toHoursString(item.seconds),
        isSaving: false,
        error: "",
      }));
      setRows(nextRows);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  }

  function updateRow(id: string, patch: Partial<EditableSuggestion>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function createWorklog(row: EditableSuggestion) {
    const parsedHours = Number(row.hoursInput);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      updateRow(row.id, { error: "Ungültige Stundenangabe." });
      return;
    }

    updateRow(row.id, { isSaving: true, error: "" });
    try {
      const response = await fetch("/api/suggestions/create-worklog", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          issueId: row.issueId,
          issueKey: row.issueKey,
          issueSummary: row.issueSummary,
          projectKey: row.projectKey,
          projectName: row.projectName,
          member,
          memberAccountId: memberAccountId || undefined,
          started: toIsoFromLocalInput(row.startedInput),
          seconds: Math.round(parsedHours * 3600),
          comment: row.comment,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setRows((prev) => prev.filter((item) => item.id !== row.id));
    } catch (error) {
      updateRow(row.id, {
        isSaving: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button type="button" onClick={generateSuggestions} disabled={isGenerating} className="bg-cyan-600 hover:bg-cyan-500">
          {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Create Suggestions
        </Button>
        <Button type="button" variant="outline" onClick={generateSuggestions} disabled={isGenerating}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <span className="text-xs text-slate-600 dark:text-slate-400">
          Vorschläge für {date} {projectKey !== "all" ? `(${projectKey})` : "(alle Projekte)"}
        </span>
      </div>

      {generateError && (
        <p className="rounded border border-rose-400/60 bg-rose-100 px-3 py-2 text-sm text-rose-900 dark:bg-rose-900/20 dark:text-rose-200">
          {generateError}
        </p>
      )}

      {rows.length === 0 && !isGenerating && (
        <p className="rounded border border-slate-300 bg-slate-100/80 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          Noch keine Vorschläge geladen. Klicke auf <strong>Create Suggestions</strong>.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded border border-slate-300 bg-slate-100/80 p-3 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="mb-2 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="font-mono text-emerald-700 dark:text-emerald-200">{row.issueKey}</span>
                {jiraBrowseUrl && (
                  <a
                    href={`${jiraBrowseUrl}/browse/${row.issueKey}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-slate-600 hover:underline dark:text-slate-400"
                  >
                    Jira
                  </a>
                )}
                <span className="text-xs text-slate-600 dark:text-slate-400">{row.projectKey} - {row.projectName}</span>
              </div>
              <span className="text-xs text-slate-600 dark:text-slate-400">{row.changedFields.slice(0, 4).join(", ") || "Ticketänderung"}</span>
            </div>

            <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">{row.changeSummary}</p>

            <div className="grid grid-cols-[1fr_140px_auto] gap-2">
              <Input
                type="datetime-local"
                value={row.startedInput}
                onChange={(event) => updateRow(row.id, { startedInput: event.target.value })}
                disabled={row.isSaving}
              />
              <Input
                type="number"
                min={0.25}
                step={0.25}
                value={row.hoursInput}
                onChange={(event) => updateRow(row.id, { hoursInput: event.target.value })}
                disabled={row.isSaving}
              />
              <Button type="button" onClick={() => createWorklog(row)} disabled={row.isSaving}>
                {row.isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Worklog
              </Button>
            </div>

            <textarea
              value={row.comment}
              onChange={(event) => updateRow(row.id, { comment: event.target.value })}
              disabled={row.isSaving}
              className="mt-2 h-24 w-full rounded border border-slate-300 bg-white/80 p-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100"
            />

            {row.error && (
              <p className="mt-2 rounded border border-rose-400/60 bg-rose-100 px-3 py-2 text-xs text-rose-900 dark:bg-rose-900/20 dark:text-rose-200">
                {row.error}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
