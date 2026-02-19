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
  } & Record<string, unknown>;
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

type JiraIssueComment = {
  id: string;
  created: string;
  updated?: string;
  body?: unknown;
  author?: {
    displayName?: string;
    emailAddress?: string;
    accountId?: string;
  };
};

type JiraIssueCommentsResponse = {
  comments: JiraIssueComment[];
  maxResults: number;
  startAt: number;
  total: number;
};

type JiraCurrentUserResponse = {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
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

export type JiraCurrentUser = {
  accountId: string;
  displayName: string;
  emailAddress: string;
};

type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
  maxIssues: number;
  teamGroupPrefix: string;
  teamFieldId: string;
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
    teamFieldId: (process.env.JIRA_TEAM_FIELD_ID ?? "").trim(),
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

function extractTeamNames(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => extractTeamNames(item))
      .map((name) => name.trim())
      .filter(Boolean);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate = record.name ?? record.value ?? record.teamName ?? record.displayName;
    if (typeof candidate === "string" && candidate.trim()) {
      return [candidate.trim()];
    }
  }
  return [];
}

function getIssueTeamNames(issue: JiraIssue, teamFieldId: string): string[] {
  if (!teamFieldId) {
    return [];
  }
  const teamValue = issue.fields[teamFieldId];
  return [...new Set(extractTeamNames(teamValue))];
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

function toFieldKey(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function toActivitySnippetFromField(field: string): string {
  if (field.includes("status") || field.includes("resolution")) {
    return "Status/Fortschritt aktualisiert";
  }
  if (field.includes("assignee")) {
    return "Zuweisung angepasst";
  }
  if (field.includes("description")) {
    return "Beschreibung überarbeitet";
  }
  if (field.includes("summary")) {
    return "Titel präzisiert";
  }
  if (field.includes("link")) {
    return "Verknüpfungen gepflegt";
  }
  if (field.includes("comment")) {
    return "Kommentar ergänzt";
  }
  if (field.includes("label")) {
    return "Labels aktualisiert";
  }
  if (field.includes("priority")) {
    return "Priorität abgestimmt";
  }
  if (field.includes("component")) {
    return "Komponenten angepasst";
  }
  if (field.includes("fix version") || field.includes("version")) {
    return "Versionen gepflegt";
  }
  if (field.includes("sprint")) {
    return "Sprintbezug aktualisiert";
  }
  return "Ticketinhalt bearbeitet";
}

function estimateSuggestionHours(
  fieldKeys: string[],
  historyCount: number,
  commentCount: number
): number {
  const uniqueFields = new Set(fieldKeys);
  let hours = 0.75;
  hours += Math.min(1.75, historyCount * 0.35);
  hours += Math.min(1.0, uniqueFields.size * 0.15);
  hours += Math.min(1.0, commentCount * 0.25);

  if (uniqueFields.has("status") || uniqueFields.has("resolution")) {
    hours += 0.25;
  }

  return Math.min(6, roundToQuarter(hours));
}

function buildGermanSuggestionComment(input: {
  fieldKeys: string[];
  commentCount: number;
}): { comment: string; changeSummary: string; changedFields: string[] } {
  const uniqueFields = [...new Set(input.fieldKeys)].filter(Boolean);
  const snippets = new Set<string>(["Umsetzung am Ticket"]);
  for (const field of uniqueFields) {
    snippets.add(toActivitySnippetFromField(field));
  }
  if (input.commentCount > 0) {
    snippets.add("Kommentare dokumentiert");
  }

  const snippetList = [...snippets].slice(0, 4);
  const changeSummary = snippetList.join("; ");
  const comment = changeSummary;
  const changedFields = uniqueFields.map((field) => field || "ticket");
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

  const fields = ["summary", "project", "worklog", "status"];
  if (cfg.teamFieldId) {
    fields.push(cfg.teamFieldId);
  }

  while (allIssues.length < cfg.maxIssues) {
    const response = await jiraGet<JiraIssueSearchResponse>(cfg, "/rest/api/3/search/jql", {
      jql: cfg.jql,
      fields: fields.join(","),
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
    const issueTeamNames = getIssueTeamNames(issue, cfg.teamFieldId);
    const worklogs = await getAllIssueWorklogs(cfg, issue);
    for (const worklog of worklogs) {
      if (worklog.timeSpentSeconds > 0) {
        const accountId = worklog.author?.accountId ?? "";
        const authorTeams = await getTeamsForAccount(accountId);
        const teamNames = issueTeamNames.length > 0 ? issueTeamNames : authorTeams;
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

  const fields = ["summary", "project", "worklog", "status"];
  if (cfg.teamFieldId) {
    fields.push(cfg.teamFieldId);
  }

  while (startAt < 300) {
    const response = await jiraGet<JiraIssueChangelogSearchResponse>(cfg, "/rest/api/3/search/jql", {
      jql,
      fields: fields.join(","),
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

async function fetchIssueCommentsByMemberOnDate(
  cfg: JiraConfig,
  issueId: string,
  date: string,
  memberName: string,
  accountId?: string
): Promise<JiraIssueComment[]> {
  const comments: JiraIssueComment[] = [];
  let startAt = 0;
  const maxResults = 100;
  const normalizedMember = normalizePersonName(memberName);

  while (startAt < 400) {
    const response = await jiraGet<JiraIssueCommentsResponse>(
      cfg,
      `/rest/api/3/issue/${issueId}/comment`,
      { startAt, maxResults }
    );
    comments.push(...response.comments);
    startAt += response.maxResults;
    if (startAt >= response.total || response.comments.length === 0) {
      break;
    }
  }

  return comments.filter((comment) => {
    const dateToCheck = comment.updated ?? comment.created;
    if (dayKey(dateToCheck) !== date) {
      return false;
    }
    const commentAccountId = comment.author?.accountId ?? "";
    const commentAuthorName = normalizePersonName(
      comment.author?.displayName ?? comment.author?.emailAddress ?? ""
    );
    const matchesAccount = Boolean(accountId && commentAccountId && commentAccountId === accountId);
    const matchesName = commentAuthorName.length > 0 && commentAuthorName === normalizedMember;
    return matchesAccount || matchesName;
  });
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
    const relevantComments = await fetchIssueCommentsByMemberOnDate(
      cfg,
      issue.id,
      query.date,
      query.memberName,
      query.accountId
    );
    if (relevantHistories.length === 0 && relevantComments.length === 0) {
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

    const allItems = relevantHistories.flatMap((history) => history.items ?? []);
    const fieldKeys = allItems.map((item) => toFieldKey(item.field)).filter(Boolean);
    if (relevantComments.length > 0) {
      fieldKeys.push("comment");
    }

    const hours = estimateSuggestionHours(fieldKeys, relevantHistories.length, relevantComments.length);
    const seconds = Math.max(900, Math.round(hours * 3600));
    const fallbackStarted = new Date(`${query.date}T10:00:00.000Z`).toISOString();
    const startCandidates = [
      ...relevantHistories.map((history) => history.created),
      ...relevantComments.map((comment) => comment.created),
    ]
      .map((value) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString();
      })
      .filter((value): value is string => Boolean(value))
      .sort();
    const normalizedStarted = startCandidates[0] ?? fallbackStarted;
    const summary = issue.fields.summary ?? "Ohne Titel";
    const { comment, changeSummary, changedFields } = buildGermanSuggestionComment({
      fieldKeys,
      commentCount: relevantComments.length,
    });
    const aggregateId = relevantHistories[0]?.id ?? relevantComments[0]?.id ?? issue.id;
    suggestions.push({
      id: `${issue.key}:${aggregateId}`,
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

export async function getJiraCurrentUser(): Promise<JiraCurrentUser> {
  const cfg = getConfig();
  const me = await jiraGet<JiraCurrentUserResponse>(cfg, "/rest/api/3/myself", {});
  return {
    accountId: me.accountId ?? "",
    displayName: me.displayName ?? "",
    emailAddress: me.emailAddress ?? "",
  };
}
