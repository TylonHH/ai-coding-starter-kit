import type { WorklogEntry } from "@/lib/jira";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type WorklogRow = {
  id: string;
  issue_id: string;
  issue_key: string;
  issue_summary: string;
  project_key: string;
  project_name: string;
  author: string;
  author_account_id: string;
  team_names: string[] | null;
  started: string;
  seconds: number;
  comment: string | null;
};

type ContributorTargetRow = {
  author: string;
  target_hours: number;
};

function toRow(entry: WorklogEntry): WorklogRow {
  return {
    id: entry.id,
    issue_id: entry.issueId,
    issue_key: entry.issueKey,
    issue_summary: entry.issueSummary,
    project_key: entry.projectKey,
    project_name: entry.projectName,
    author: entry.author,
    author_account_id: entry.authorAccountId,
    team_names: entry.teamNames,
    started: entry.started,
    seconds: entry.seconds,
    comment: entry.comment,
  };
}

function toLegacyRow(entry: WorklogEntry) {
  return {
    id: entry.id,
    issue_id: entry.issueId,
    issue_key: entry.issueKey,
    issue_summary: entry.issueSummary,
    project_key: entry.projectKey,
    project_name: entry.projectName,
    author: entry.author,
    started: entry.started,
    seconds: entry.seconds,
  };
}

function toLegacyRowWithComment(entry: WorklogEntry) {
  return {
    id: entry.id,
    issue_id: entry.issueId,
    issue_key: entry.issueKey,
    issue_summary: entry.issueSummary,
    project_key: entry.projectKey,
    project_name: entry.projectName,
    author: entry.author,
    started: entry.started,
    seconds: entry.seconds,
    comment: entry.comment,
  };
}

function fromRow(row: WorklogRow): WorklogEntry {
  return {
    id: row.id,
    issueId: row.issue_id,
    issueKey: row.issue_key,
    issueSummary: row.issue_summary,
    projectKey: row.project_key,
    projectName: row.project_name,
    author: row.author,
    authorAccountId: row.author_account_id,
    teamNames: row.team_names ?? [],
    started: row.started,
    seconds: row.seconds,
    comment: row.comment ?? "",
  };
}

export async function upsertWorklogs(entries: WorklogEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const chunkSize = 500;
  const uniqueById = new Map<string, WorklogEntry>();
  for (const entry of entries) {
    uniqueById.set(entry.id, entry);
  }
  const dedupedEntries = [...uniqueById.values()];

  for (let index = 0; index < dedupedEntries.length; index += chunkSize) {
    const chunk = dedupedEntries.slice(index, index + chunkSize).map(toRow);
    let { error } = await supabase.from("jira_worklogs").upsert(chunk, {
      onConflict: "id",
      ignoreDuplicates: false,
    });

    if (error?.message && (error.message.includes("author_account_id") || error.message.includes("team_names") || error.message.includes("comment"))) {
      const semiLegacyChunk = dedupedEntries.slice(index, index + chunkSize).map(toLegacyRowWithComment);
      const semiFallback = await supabase.from("jira_worklogs").upsert(semiLegacyChunk, {
        onConflict: "id",
        ignoreDuplicates: false,
      });
      error = semiFallback.error;

      if (error?.message?.includes("comment")) {
        const legacyChunk = dedupedEntries.slice(index, index + chunkSize).map(toLegacyRow);
        const fallback = await supabase.from("jira_worklogs").upsert(legacyChunk, {
          onConflict: "id",
          ignoreDuplicates: false,
        });
        error = fallback.error;
      }
    }

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
  }
}

export async function readAllWorklogs(): Promise<WorklogEntry[]> {
  const supabase = getSupabaseAdmin();
  const pageSize = 1000;
  let from = 0;
  const allRows: WorklogRow[] = [];

  while (true) {
    const to = from + pageSize - 1;
    let data: unknown[] | null = null;
    let error: { message: string } | null = null;

    {
      const response = await supabase
        .from("jira_worklogs")
        .select(
          "id,issue_id,issue_key,issue_summary,project_key,project_name,author,author_account_id,team_names,started,seconds,comment"
        )
        .order("started", { ascending: true })
        .range(from, to);
      data = response.data;
      error = response.error;
    }

    if (error?.message?.includes("author_account_id") || error?.message?.includes("team_names") || error?.message?.includes("comment")) {
      const fallbackWithComment = await supabase
        .from("jira_worklogs")
        .select("id,issue_id,issue_key,issue_summary,project_key,project_name,author,started,seconds,comment")
        .order("started", { ascending: true })
        .range(from, to);
      data = (fallbackWithComment.data ?? []).map((row) => ({
        ...row,
        author_account_id: "unknown-account",
        team_names: [],
      }));
      error = fallbackWithComment.error;

      if (error?.message?.includes("comment")) {
        const fallback = await supabase
          .from("jira_worklogs")
          .select("id,issue_id,issue_key,issue_summary,project_key,project_name,author,started,seconds")
          .order("started", { ascending: true })
          .range(from, to);
        data = (fallback.data ?? []).map((row) => ({
          ...row,
          author_account_id: "unknown-account",
          team_names: [],
          comment: "",
        }));
        error = fallback.error;
      }
    }

    if (error) {
      throw new Error(`Supabase read failed: ${error.message}`);
    }

    const rows = (data ?? []) as WorklogRow[];
    allRows.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return allRows.map(fromRow);
}

export async function readContributorTargets(): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("jira_contributor_targets").select("author,target_hours");
  if (error) {
    if (error.message.includes("jira_contributor_targets")) {
      return {};
    }
    throw new Error(`Supabase read targets failed: ${error.message}`);
  }

  const rows = (data ?? []) as ContributorTargetRow[];
  const targets: Record<string, number> = {};
  for (const row of rows) {
    targets[row.author] = Number(row.target_hours);
  }
  return targets;
}

export async function upsertContributorTarget(author: string, targetHours: number): Promise<void> {
  const supabase = getSupabaseAdmin();
  const normalizedAuthor = author.trim();
  const { error } = await supabase.from("jira_contributor_targets").upsert(
    {
      author: normalizedAuthor,
      target_hours: targetHours,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "author", ignoreDuplicates: false }
  );

  if (error) {
    throw new Error(`Supabase upsert target failed: ${error.message}`);
  }
}
