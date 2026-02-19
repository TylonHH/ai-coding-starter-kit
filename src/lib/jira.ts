type JiraIssueSearchResponse = {
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

type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
  maxIssues: number;
  teamGroupPrefix: string;
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
