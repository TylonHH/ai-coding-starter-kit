type JiraIssueSearchResponse = {
  issues: JiraIssue[];
  maxResults: number;
  startAt: number;
  total: number;
};

type JiraIssueChangelogSearchResponse = {
  issues: JiraIssue[];
  maxResults: number;
  startAt: number;
  total: number;
};

type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    project?: {
      key: string;
      name: string;
    };
    status?: {
      name: string;
    };
    worklog?: JiraWorklogContainer;
  };
  changelog?: {
    histories?: JiraChangelogHistory[];
  };
};

type JiraWorklogContainer = {
  maxResults: number;
  startAt: number;
  total: number;
  worklogs: JiraWorklog[];
};

type JiraWorklogResponse = {
  maxResults: number;
  startAt: number;
  total: number;
  worklogs: JiraWorklog[];
};

type JiraWorklog = {
  id: string;
  timeSpentSeconds: number;
  started: string;
  comment?: unknown;
  author?: {
    displayName?: string;
    emailAddress?: string;
    accountId?: string;
  };
};

type JiraChangelogHistory = {
  id: string;
  created: string;
  author?: {
    displayName?: string;
    accountId?: string;
  };
  items?: JiraChangelogItem[];
};

type JiraChangelogItem = {
  field?: string;
  fromString?: string;
  toString?: string;
};

export type WorklogEntry = {
  id: string;
  issueId: string;
  issueKey: string;
  issueSummary: string;
  projectKey: string;
  projectName: string;
  author: string;
  authorAccountId: string;
  teamNames: string[];
  started: string;
  seconds: number;
  comment: string;
};

export type WorklogSuggestion = {
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

type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
  maxIssues: number;
  teamGroupPrefix: string;
};

type SuggestionQuery = {
  date: string;
  memberName: string;
  accountId?: string;
  projectKey?: string;
  existingIssueKeys?: string[];
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getConfig(): JiraConfig {
  return {
    baseUrl: getRequiredEnv("JIRA_BASE_URL"),
    email: getRequiredEnv("JIRA_EMAIL"),
    apiToken: getRequiredEnv("JIRA_API_TOKEN"),
    jql: process.env.JIRA_JQL ?? "worklogDate >= startOfMonth(-2)",
    maxIssues: Number.parseInt(process.env.JIRA_MAX_ISSUES ?? "100", 10),
    teamGroupPrefix: (process.env.JIRA_TEAM_GROUP_PREFIX ?? "").trim().toLowerCase(),
  };
}

function authHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

type JiraGroupLike = {
  name?: string;
};

type JiraUserGroupsResponse = JiraGroupLike[] | { values?: JiraGroupLike[] };

function extractAdfText(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }
  const typed = node as {
    type?: string;
    text?: string;
    attrs?: { text?: string; shortName?: string };
    content?: unknown[];
  };
  if (typed.type === "text" && typeof typed.text === "string") {
    return typed.text;
  }
  if (typed.type === "hardBreak") {
    return "\n";
  }
  if (typed.type === "mention" && typeof typed.attrs?.text === "string") {
    return typed.attrs.text;
  }
  if (typed.type === "emoji" && typeof typed.attrs?.shortName === "string") {
    return typed.attrs.shortName;
  }
  if (Array.isArray(typed.content)) {
    return typed.content.map(extractAdfText).join(" ").trim();
  }
  return "";
}

function normalizeWorklogComment(comment: unknown): string {
  if (!comment) {
    return "";
  }
  if (typeof comment === "string") {
    return comment;
  }
  const extracted = extractAdfText(comment).replace(/\s+/g, " ").trim();
  return extracted;
}

async function jiraGet<T>(
  cfg: JiraConfig,
  path: string,
  query: Record<string, string | number>
): Promise<T> {
  const url = new URL(path, cfg.baseUrl.endsWith("/") ? cfg.baseUrl : `${cfg.baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: authHeader(cfg.email, cfg.apiToken),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

async function jiraPost<T>(
  cfg: JiraConfig,
  path: string,
  body: unknown,
  query?: Record<string, string | number>
): Promise<T> {
  const url = new URL(path, cfg.baseUrl.endsWith("/") ? cfg.baseUrl : `${cfg.baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authHeader(cfg.email, cfg.apiToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Jira request failed (${response.status}): ${bodyText}`);
  }

  return (await response.json()) as T;
}

function normalizeWorklog(issue: JiraIssue, worklog: JiraWorklog, teamNames: string[]): WorklogEntry {
  return {
    // Worklog IDs can collide across issues in some Jira setups, so keep IDs globally unique.
    id: `${issue.id}:${worklog.id}`,
    issueId: issue.id,
    issueKey: issue.key,
    issueSummary: issue.fields.summary,
    projectKey: issue.fields.project?.key ?? "UNKNOWN",
    projectName: issue.fields.project?.name ?? "Unknown project",
    author: worklog.author?.displayName ?? worklog.author?.emailAddress ?? "Unknown user",
    authorAccountId: worklog.author?.accountId ?? "unknown-account",
    teamNames,
    started: worklog.started,
    seconds: worklog.timeSpentSeconds,
    comment: normalizeWorklogComment(worklog.comment),
  };
}

function normalizePersonName(value: string): string {
  return value.trim().toLowerCase();
}

function dayKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function roundToQuarter(hours: number): number {
  return Math.max(0.25, Math.round(hours * 4) / 4);
}

function estimateSuggestionHours(items: JiraChangelogItem[]): number {
  const fields = new Set(items.map((item) => (item.field ?? "").toLowerCase()));
  let hours = 0.5 + items.length * 0.25;

  if (fields.has("status") || fields.has("resolution")) {
    hours += 0.5;
  }
  if (fields.has("description") || fields.has("summary")) {
    hours += 0.25;
  }
  if (fields.has("assignee")) {
    hours += 0.25;
  }

  return Math.min(3, roundToQuarter(hours));
}

function toGermanChangeLine(item: JiraChangelogItem): string {
  const field = item.field?.trim() || "Feld";
  const from = item.fromString?.trim();
  const to = item.toString?.trim();
  if (from && to) {
    return `${field}: "${from}" -> "${to}"`;
  }
  if (to) {
    return `${field} auf "${to}" gesetzt`;
  }
  return `${field} aktualisiert`;
}

function buildGermanSuggestionComment(
  issueKey: string,
  issueSummary: string,
  items: JiraChangelogItem[]
): { comment: string; changeSummary: string; changedFields: string[] } {
  const lines = items.slice(0, 4).map(toGermanChangeLine);
  const changedFields = items
    .map((item) => item.field?.trim())
    .filter((field): field is string => Boolean(field));
  const changeSummary = lines.length > 0 ? lines.join("; ") : "Ticketinhalt aktualisiert";
  const comment = `Bearbeitung von ${issueKey} (${issueSummary}). Änderungen: ${changeSummary}.`;
  return { comment, changeSummary, changedFields };
}

function toJiraStarted(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid started datetime");
  }
  return date.toISOString().replace("Z", "+0000");
}

function toAdfComment(comment: string): { type: "doc"; version: 1; content: Array<{ type: "paragraph"; content: Array<{ type: "text"; text: string }> }> } {
  const normalized = comment.trim();
  const lines = normalized.length > 0 ? normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : ["Arbeit am Ticket dokumentiert."];
  return {
    type: "doc",
    version: 1,
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

async function getAllIssueWorklogs(cfg: JiraConfig, issue: JiraIssue): Promise<JiraWorklog[]> {
  const initial = issue.fields.worklog;
  if (!initial) {
    return [];
  }

  const worklogs = [...initial.worklogs];
  let startAt = initial.startAt + initial.maxResults;

  while (worklogs.length < initial.total) {
    const response = await jiraGet<JiraWorklogResponse>(
      cfg,
      `/rest/api/3/issue/${issue.id}/worklog`,
      {
        startAt,
        maxResults: 100,
      }
    );
    worklogs.push(...response.worklogs);
    startAt += response.maxResults;
  }

  return worklogs;
}

async function fetchIssues(cfg: JiraConfig): Promise<JiraIssue[]> {
  const allIssues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 100;

  while (allIssues.length < cfg.maxIssues) {
    const response = await jiraGet<JiraIssueSearchResponse>(cfg, "/rest/api/3/search/jql", {
      jql: cfg.jql,
      fields: "summary,project,worklog,status",
      maxResults,
      startAt,
    });
    allIssues.push(...response.issues);
    startAt += response.maxResults;

    if (startAt >= response.total || response.issues.length === 0) {
      break;
    }
  }

  return allIssues.slice(0, cfg.maxIssues);
}

export async function fetchJiraWorklogs(): Promise<WorklogEntry[]> {
  const cfg = getConfig();
  const issues = await fetchIssues(cfg);
  const entries: WorklogEntry[] = [];
  const teamsByAccountId = new Map<string, string[]>();

  async function getTeamsForAccount(accountId: string): Promise<string[]> {
    if (!accountId) {
      return [];
    }
    const cached = teamsByAccountId.get(accountId);
    if (cached) {
      return cached;
    }

    try {
      const groupsResponse = await jiraGet<JiraUserGroupsResponse>(cfg, "/rest/api/3/user/groups", {
        accountId,
      });
      const groups = Array.isArray(groupsResponse) ? groupsResponse : groupsResponse.values ?? [];
      const groupNames = groups
        .map((group) => group.name?.trim())
        .filter((name): name is string => Boolean(name))
        .filter((name) =>
          cfg.teamGroupPrefix ? name.toLowerCase().includes(cfg.teamGroupPrefix) : true
        );

      const unique = [...new Set(groupNames)];
      teamsByAccountId.set(accountId, unique);
      return unique;
    } catch {
      teamsByAccountId.set(accountId, []);
      return [];
    }
  }

  for (const issue of issues) {
    const worklogs = await getAllIssueWorklogs(cfg, issue);
    for (const worklog of worklogs) {
      if (worklog.timeSpentSeconds > 0) {
        const accountId = worklog.author?.accountId ?? "";
        const teamNames = await getTeamsForAccount(accountId);
        entries.push(normalizeWorklog(issue, worklog, teamNames));
      }
    }
  }

  return entries.sort((a, b) => a.started.localeCompare(b.started));
}

async function fetchIssuesUpdatedOnDay(
  cfg: JiraConfig,
  date: string,
  projectKey?: string
): Promise<JiraIssue[]> {
  const start = `${date} 00:00`;
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = `${nextDate.toISOString().slice(0, 10)} 00:00`;
  const projectFilter = projectKey ? ` AND project = "${projectKey.replace(/"/g, "")}"` : "";
  const jql = `updated >= "${start}" AND updated < "${end}"${projectFilter} ORDER BY updated DESC`;

  const allIssues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 50;

  while (startAt < 300) {
    const response = await jiraGet<JiraIssueChangelogSearchResponse>(cfg, "/rest/api/3/search/jql", {
      jql,
      fields: "summary,project,worklog,status",
      expand: "changelog",
      maxResults,
      startAt,
    });
    allIssues.push(...response.issues);
    startAt += response.maxResults;
    if (startAt >= response.total || response.issues.length === 0) {
      break;
    }
  }

  return allIssues;
}

export async function generateWorklogSuggestions(query: SuggestionQuery): Promise<WorklogSuggestion[]> {
  const cfg = getConfig();
  const normalizedMember = normalizePersonName(query.memberName);
  const existingIssueKeys = new Set(query.existingIssueKeys ?? []);
  const issues = await fetchIssuesUpdatedOnDay(cfg, query.date, query.projectKey);
  const suggestions: WorklogSuggestion[] = [];

  for (const issue of issues) {
    if (existingIssueKeys.has(issue.key)) {
      continue;
    }

    const histories = issue.changelog?.histories ?? [];
    const relevantHistories = histories.filter((history) => {
      if (dayKey(history.created) !== query.date) {
        return false;
      }
      const historyAccountId = history.author?.accountId ?? "";
      const historyName = normalizePersonName(history.author?.displayName ?? "");
      const matchesAccount = Boolean(query.accountId && historyAccountId && historyAccountId === query.accountId);
      const matchesName = historyName.length > 0 && historyName === normalizedMember;
      return matchesAccount || matchesName;
    });

    if (relevantHistories.length === 0) {
      continue;
    }

    const issueWorklogs = await getAllIssueWorklogs(cfg, issue);
    const hasTrackedOnDay = issueWorklogs.some((worklog) => {
      if (dayKey(worklog.started) !== query.date) {
        return false;
      }
      const worklogAccountId = worklog.author?.accountId ?? "";
      const worklogName = normalizePersonName(
        worklog.author?.displayName ?? worklog.author?.emailAddress ?? ""
      );
      const matchesAccount = Boolean(query.accountId && worklogAccountId && worklogAccountId === query.accountId);
      const matchesName = worklogName.length > 0 && worklogName === normalizedMember;
      return matchesAccount || matchesName;
    });

    if (hasTrackedOnDay) {
      continue;
    }

    for (const history of relevantHistories) {
      const items = history.items ?? [];
      const hours = estimateSuggestionHours(items);
      const seconds = Math.max(900, Math.round(hours * 3600));
      const normalizedStarted = Number.isNaN(new Date(history.created).getTime())
        ? new Date(`${query.date}T10:00:00.000Z`).toISOString()
        : new Date(history.created).toISOString();
      const summary = issue.fields.summary ?? "Ohne Titel";
      const { comment, changeSummary, changedFields } = buildGermanSuggestionComment(issue.key, summary, items);
      suggestions.push({
        id: `${issue.key}:${history.id}`,
        issueId: issue.id,
        issueKey: issue.key,
        issueSummary: summary,
        projectKey: issue.fields.project?.key ?? "UNKNOWN",
        projectName: issue.fields.project?.name ?? "Unknown project",
        started: normalizedStarted,
        seconds,
        comment,
        changedFields,
        changeSummary,
      });
    }
  }

  return suggestions.sort((a, b) => a.started.localeCompare(b.started));
}

export async function createJiraWorklog(input: {
  issueKey: string;
  started: string;
  seconds: number;
  comment: string;
}): Promise<{ id: string; started: string; seconds: number; comment: string }> {
  const cfg = getConfig();
  const payload = {
    timeSpentSeconds: Math.max(60, Math.round(input.seconds)),
    started: toJiraStarted(input.started),
    comment: toAdfComment(input.comment),
  };
  const created = await jiraPost<JiraWorklog>(
    cfg,
    `/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/worklog`,
    payload
  );

  return {
    id: created.id,
    started: created.started,
    seconds: created.timeSpentSeconds,
    comment: normalizeWorklogComment(created.comment),
  };
}
