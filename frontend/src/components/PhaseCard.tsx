import type { Task } from "../api/client";
import { StatusBadge } from "./StatusBadge";

interface PhaseCardProps {
  phase: string;
  isCurrent: boolean;
  tasks: Task[];
  canApprove: boolean;
  canReject: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}

export function PhaseCard({
  phase,
  isCurrent,
  tasks,
  canApprove,
  canReject,
  onApprove,
  onReject,
}: PhaseCardProps) {
  const phaseTasks = tasks.filter((t) => t.phase === phase);
  const completed = phaseTasks.filter((t) => t.status === "COMPLETED").length;
  const total = phaseTasks.length;

  return (
    <div
      className={`rounded-lg border p-4 ${
        isCurrent
          ? "border-indigo-300 bg-indigo-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold capitalize">{phase}</h3>
        {isCurrent && (
          <span className="text-xs font-medium text-indigo-600 bg-indigo-100 px-2 py-1 rounded">
            Current
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Tasks</span>
            <span>
              {completed}/{total}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all"
              style={{ width: total > 0 ? `${(completed / total) * 100}%` : "0%" }}
            />
          </div>
        </div>
      )}

      {phaseTasks.length > 0 && (
        <div className="space-y-2 mb-3">
          {phaseTasks.map((task) => (
            <div
              key={task.task_id}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-gray-700 truncate mr-2">
                {task.assignee}: {task.objective.slice(0, 60)}
              </span>
              <StatusBadge status={task.status} />
            </div>
          ))}
        </div>
      )}

      {(canApprove || canReject) && (
        <div className="flex gap-2 mt-4">
          {canApprove && (
            <button
              onClick={onApprove}
              className="flex-1 px-3 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
            >
              Approve
            </button>
          )}
          {canReject && (
            <button
              onClick={() => {
                const reason = window.prompt("Rejection reason:");
                if (reason) onReject(reason);
              }}
              className="flex-1 px-3 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}
