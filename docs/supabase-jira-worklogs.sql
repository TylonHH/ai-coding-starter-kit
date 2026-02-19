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

-- Security hardening: keep these tables private behind server-side service role access.
alter table public.jira_worklogs enable row level security;
alter table public.jira_contributor_targets enable row level security;

-- Force RLS even for table owner connections (service_role still has bypassrls).
alter table public.jira_worklogs force row level security;
alter table public.jira_contributor_targets force row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jira_worklogs'
      and policyname = 'jira_worklogs_service_role_all'
  ) then
    create policy jira_worklogs_service_role_all
      on public.jira_worklogs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jira_contributor_targets'
      and policyname = 'jira_contributor_targets_service_role_all'
  ) then
    create policy jira_contributor_targets_service_role_all
      on public.jira_contributor_targets
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

revoke all on table public.jira_worklogs from anon, authenticated;
revoke all on table public.jira_contributor_targets from anon, authenticated;
