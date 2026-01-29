import { useParams, Link } from "react-router-dom";
import {
  useJobDetail,
  useCancelJob,
  useApprovePhase,
  useRejectPhase,
} from "../hooks/useJob";
import { useSSE } from "../hooks/useSSE";
import { StatusBadge } from "../components/StatusBadge";
import { PhaseCard } from "../components/PhaseCard";
import { TraceTimeline } from "../components/TraceTimeline";

const PHASES = ["spec", "impl", "test"] as const;

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job, isLoading, error } = useJobDetail(id!);
  const cancelJob = useCancelJob();
  const approvePhase = useApprovePhase();
  const rejectPhase = useRejectPhase();
  useSSE(id);

  if (isLoading) {
    return <p className="text-gray-500">Loading job details...</p>;
  }

  if (error || !job) {
    return (
      <p className="text-red-600">
        Error loading job: {error?.message ?? "Not found"}
      </p>
    );
  }

  const canCancel = !["COMPLETED", "FAILED", "CANCELED"].includes(job.status);
  const isWaitingApproval = job.status === "WAITING_APPROVAL";

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/jobs" className="text-gray-500 hover:text-gray-700">
          Jobs
        </Link>
        <span className="text-gray-300">/</span>
        <span className="font-mono text-sm">{job.job_id}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-xl font-bold">Job {job.job_id}</h1>
              <StatusBadge status={job.status} />
            </div>
            <p className="text-gray-600">{job.user_prompt}</p>
          </div>
          {canCancel && (
            <button
              onClick={() => cancelJob.mutate(job.job_id)}
              disabled={cancelJob.isPending}
              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Mode</span>
            <p className="font-medium">{job.mode}</p>
          </div>
          <div>
            <span className="text-gray-500">Parallelism</span>
            <p className="font-medium">{job.parallelism}</p>
          </div>
          <div>
            <span className="text-gray-500">Repository</span>
            <p className="font-medium font-mono text-xs">{job.repo_root}</p>
          </div>
          <div>
            <span className="text-gray-500">Branch</span>
            <p className="font-medium font-mono text-xs">
              {job.git.job_branch}
            </p>
          </div>
        </div>

        {job.last_error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">
              <span className="font-medium">Error:</span> {job.last_error}
            </p>
            <p className="text-xs text-red-500 mt-1">
              Retry count: {job.retry_count}
            </p>
          </div>
        )}
      </div>

      {/* Phase Cards */}
      <h2 className="text-lg font-semibold mb-4">Phases</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {PHASES.map((phase) => (
          <PhaseCard
            key={phase}
            phase={phase}
            isCurrent={job.current_phase === phase}
            tasks={job.tasks}
            canApprove={isWaitingApproval && job.current_phase === phase}
            canReject={isWaitingApproval && job.current_phase === phase}
            onApprove={() =>
              approvePhase.mutate({ jobId: job.job_id, phase })
            }
            onReject={(reason) =>
              rejectPhase.mutate({ jobId: job.job_id, phase, reason })
            }
          />
        ))}
      </div>

      {/* Trace Timeline */}
      <h2 className="text-lg font-semibold mb-4">Trace Timeline</h2>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <TraceTimeline traces={job.traces} />
      </div>
    </div>
  );
}
