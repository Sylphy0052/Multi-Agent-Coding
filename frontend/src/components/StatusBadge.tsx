const STATUS_COLORS: Record<string, string> = {
  RECEIVED: "bg-gray-100 text-gray-700",
  QUEUED: "bg-yellow-100 text-yellow-700",
  PLANNING: "bg-blue-100 text-blue-700",
  DISPATCHED: "bg-blue-100 text-blue-700",
  RUNNING: "bg-indigo-100 text-indigo-700",
  AGGREGATING: "bg-purple-100 text-purple-700",
  WAITING_APPROVAL: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  COMMITTING: "bg-teal-100 text-teal-700",
  COMPLETED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-700",
  CANCELED: "bg-gray-100 text-gray-500",
  WAITING_RETRY: "bg-orange-100 text-orange-700",
};

export function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {status}
    </span>
  );
}
