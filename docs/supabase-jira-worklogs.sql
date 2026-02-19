create table if not exists public.jira_worklogs (
  id text primary key,
  issue_id text not null,
  issue_key text not null,
  issue_summary text not null,
  project_key text not null,
  project_name text not null,
  author text not null,
  started timestamptz not null,
  seconds integer not null check (seconds >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists jira_worklogs_started_idx on public.jira_worklogs (started desc);
create index if not exists jira_worklogs_author_idx on public.jira_worklogs (author);
create index if not exists jira_worklogs_project_idx on public.jira_worklogs (project_name);
create index if not exists jira_worklogs_issue_key_idx on public.jira_worklogs (issue_key);
