create table if not exists public.jira_worklogs (
  id text primary key,
  issue_id text not null,
  issue_key text not null,
  issue_summary text not null,
  project_key text not null,
  project_name text not null,
  author text not null,
  author_account_id text not null default 'unknown-account',
  team_names text[] not null default '{}',
  started timestamptz not null,
  seconds integer not null check (seconds >= 0),
  comment text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.jira_worklogs add column if not exists author_account_id text not null default 'unknown-account';
alter table public.jira_worklogs add column if not exists team_names text[] not null default '{}';
alter table public.jira_worklogs add column if not exists comment text not null default '';

create index if not exists jira_worklogs_started_idx on public.jira_worklogs (started desc);
create index if not exists jira_worklogs_author_idx on public.jira_worklogs (author);
create index if not exists jira_worklogs_project_idx on public.jira_worklogs (project_name);
create index if not exists jira_worklogs_issue_key_idx on public.jira_worklogs (issue_key);
create index if not exists jira_worklogs_team_names_gin_idx on public.jira_worklogs using gin (team_names);

create table if not exists public.jira_contributor_targets (
  author text primary key,
  target_hours numeric(8,2) not null default 40,
  updated_at timestamptz not null default now()
);
