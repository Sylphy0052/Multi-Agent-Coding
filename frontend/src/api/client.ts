const API_BASE = "/api";

function getAuthHeader(): string {
  const username = localStorage.getItem("auth_username") ?? "admin";
  const password = localStorage.getItem("auth_password") ?? "changeme";
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }

  return res.json() as Promise<T>;
}

// ─── Job API ────────────────────────────────────────────

export interface CreateJobInput {
  repo_root: string;
  prompt: string;
  mode?: string;
  parallelism?: number;
  persona_set_id?: string;
  constraints?: string[];
}

export interface Job {
  job_id: string;
  status: string;
  user_prompt: string;
  mode: string;
  parallelism: number;
  persona_set_id: string;
  repo_root: string;
  current_phase: string | null;
  created_at: string;
  updated_at: string;
  retry_count: number;
  last_error: string | null;
  artifacts: {
    spec_md_path: string;
    impl_md_path: string;
    test_md_path: string;
    summary_md_path: string;
  };
  git: {
    main_branch: string;
    develop_branch: string;
    job_branch: string;
    merge_policy: string;
    last_commit_hash: string | null;
    last_merge_hash: string | null;
  };
}

export interface JobDetail extends Job {
  tasks: Task[];
  traces: TraceEntry[];
}

export interface Task {
  task_id: string;
  job_id: string;
  assignee: string;
  phase: string;
  objective: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TraceEntry {
  timestamp: string;
  job_id: string;
  actor: string;
  event_type: string;
  payload_summary: string;
  refs: Record<string, string | undefined>;
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  return apiFetch<Job>("/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listJobs(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<Job[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));

  const query = searchParams.toString();
  return apiFetch<Job[]>(`/jobs${query ? `?${query}` : ""}`);
}

export async function getJob(id: string): Promise<JobDetail> {
  return apiFetch<JobDetail>(`/jobs/${id}`);
}

export async function cancelJob(id: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${id}/cancel`, { method: "POST" });
}

export async function approvePhase(
  jobId: string,
  phase: string,
): Promise<Job> {
  return apiFetch<Job>(`/jobs/${jobId}/phases/${phase}/approve`, {
    method: "POST",
  });
}

export async function rejectPhase(
  jobId: string,
  phase: string,
  reason: string,
): Promise<Job> {
  return apiFetch<Job>(`/jobs/${jobId}/phases/${phase}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
