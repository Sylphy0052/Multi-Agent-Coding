import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateJob } from "../hooks/useJob";

export function InputPage() {
  const navigate = useNavigate();
  const createJob = useCreateJob();

  const [repoRoot, setRepoRoot] = useState("");
  const [prompt, setPrompt] = useState("");
  const [parallelism, setParallelism] = useState(2);
  const [constraintsText, setConstraintsText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const constraints = constraintsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    createJob.mutate(
      {
        repo_root: repoRoot,
        prompt,
        parallelism,
        constraints: constraints.length > 0 ? constraints : undefined,
      },
      {
        onSuccess: (job) => {
          navigate(`/jobs/${job.job_id}`);
        },
      },
    );
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">New Job</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="repo_root"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Repository Root
          </label>
          <input
            id="repo_root"
            type="text"
            value={repoRoot}
            onChange={(e) => setRepoRoot(e.target.value)}
            placeholder="/path/to/repository"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p className="mt-1 text-sm text-gray-500">
            Absolute path to the target git repository.
          </p>
        </div>

        <div>
          <label
            htmlFor="prompt"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            required
            placeholder="Describe the task you want the agents to work on..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label
            htmlFor="constraints"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Constraints
          </label>
          <textarea
            id="constraints"
            value={constraintsText}
            onChange={(e) => setConstraintsText(e.target.value)}
            rows={3}
            placeholder={"Time limit: 30 min\nCost limit: $5\nMust include unit tests"}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p className="mt-1 text-sm text-gray-500">
            One constraint per line (optional).
          </p>
        </div>

        <div>
          <label
            htmlFor="parallelism"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Parallelism (Kobito count)
          </label>
          <input
            id="parallelism"
            type="number"
            min={1}
            max={10}
            value={parallelism}
            onChange={(e) => setParallelism(parseInt(e.target.value, 10))}
            className="w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p className="mt-1 text-sm text-gray-500">
            Number of parallel worker agents (1-10).
          </p>
        </div>

        <div className="pt-4">
          <button
            type="submit"
            disabled={createJob.isPending}
            className="w-full py-3 px-4 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createJob.isPending ? "Creating..." : "Create Job"}
          </button>

          {createJob.isError && (
            <p className="mt-2 text-sm text-red-600">
              Error: {createJob.error.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
