import type { TraceEntry } from "../api/client";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ACTOR_COLORS: Record<string, string> = {
  web: "text-gray-500",
  "ui-chan": "text-pink-600",
  "ai-chan": "text-purple-600",
  system: "text-gray-600",
  git: "text-green-600",
};

function actorColor(actor: string): string {
  if (actor.startsWith("kobito")) return "text-blue-600";
  return ACTOR_COLORS[actor] ?? "text-gray-500";
}

export function TraceTimeline({ traces }: { traces: TraceEntry[] }) {
  if (traces.length === 0) {
    return <p className="text-sm text-gray-400">No trace entries yet.</p>;
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {traces.map((trace, idx) => (
          <li key={`${trace.timestamp}-${idx}`}>
            <div className="relative pb-6">
              {idx < traces.length - 1 && (
                <span
                  className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200"
                  aria-hidden="true"
                />
              )}
              <div className="relative flex space-x-3">
                <div>
                  <span className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center ring-4 ring-white">
                    <span className={`text-xs font-bold ${actorColor(trace.actor)}`}>
                      {trace.actor.slice(0, 2).toUpperCase()}
                    </span>
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className={`font-medium ${actorColor(trace.actor)}`}>
                      {trace.actor}
                    </span>
                    <span className="ml-2 text-gray-500">
                      [{trace.event_type}]
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-700">
                    {trace.payload_summary}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {formatTime(trace.timestamp)}
                  </p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
