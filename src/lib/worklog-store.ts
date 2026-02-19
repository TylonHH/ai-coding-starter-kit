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
  started: string;
  seconds: number;
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
    started: entry.started,
    seconds: entry.seconds,
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
    started: row.started,
    seconds: row.seconds,
  };
}

export async function upsertWorklogs(entries: WorklogEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const chunkSize = 500;

  for (let index = 0; index < entries.length; index += chunkSize) {
    const chunk = entries.slice(index, index + chunkSize).map(toRow);
    const { error } = await supabase.from("jira_worklogs").upsert(chunk, {
      onConflict: "id",
      ignoreDuplicates: false,
    });
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
    const { data, error } = await supabase
      .from("jira_worklogs")
      .select("id,issue_id,issue_key,issue_summary,project_key,project_name,author,started,seconds")
      .order("started", { ascending: true })
      .range(from, to);

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
