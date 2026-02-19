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
  author?: {
    displayName?: string;
    emailAddress?: string;
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
  started: string;
  seconds: number;
};

type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
  maxIssues: number;
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
  };
}

function authHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
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

function normalizeWorklog(issue: JiraIssue, worklog: JiraWorklog): WorklogEntry {
  return {
    // Worklog IDs can collide across issues in some Jira setups, so keep IDs globally unique.
    id: `${issue.id}:${worklog.id}`,
    issueId: issue.id,
    issueKey: issue.key,
    issueSummary: issue.fields.summary,
    projectKey: issue.fields.project?.key ?? "UNKNOWN",
    projectName: issue.fields.project?.name ?? "Unknown project",
    author: worklog.author?.displayName ?? worklog.author?.emailAddress ?? "Unknown user",
    started: worklog.started,
    seconds: worklog.timeSpentSeconds,
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

  for (const issue of issues) {
    const worklogs = await getAllIssueWorklogs(cfg, issue);
    for (const worklog of worklogs) {
      if (worklog.timeSpentSeconds > 0) {
        entries.push(normalizeWorklog(issue, worklog));
      }
    }
  }

  return entries.sort((a, b) => a.started.localeCompare(b.started));
}
