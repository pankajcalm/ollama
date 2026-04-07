import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDetailedModels, pullModel, deleteModel, fetchHealth } from "@/api";

export default function ModelLibrary() {
  const queryClient = useQueryClient();
  const [modelName, setModelName] = useState("");
  const [pullProgress, setPullProgress] = useState("Idle");

  const { data: models = [], isLoading, error } = useQuery({
    queryKey: ["modelLibrary"],
    queryFn: getDetailedModels,
    refetchInterval: 30000,
  });

  const { data: isHealthy } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  });

  const pullMutation = useMutation({
    mutationFn: async (name: string) => {
      for await (const event of pullModel(name)) {
        if (event.total && event.completed) {
          const pct = Math.round((event.completed / event.total) * 100);
          setPullProgress(`${event.status} (${pct}%)`);
        } else {
          setPullProgress(event.status || "Pulling...");
        }
      }
    },
    onSuccess: () => {
      setPullProgress("Complete");
      setModelName("");
      queryClient.invalidateQueries({ queryKey: ["modelLibrary"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err) => {
      setPullProgress(err instanceof Error ? err.message : "Failed to pull model");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modelLibrary"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const sorted = useMemo(
    () => [...models].sort((a, b) => b.modifiedAt - a.modifiedAt),
    [models],
  );

  return (
    <main className="h-full overflow-y-auto bg-[var(--app-bg)] p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">Model Library</h1>
          <p className="text-sm text-[var(--muted-fg)]">Manage local models for private, offline Ollama chats.</p>
        </header>

        {!isHealthy && (
          <div className="rounded-lg border border-amber-300/50 bg-amber-100/60 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Ollama engine is not reachable. Start it first to list, pull, or delete models.
          </div>
        )}

        <section className="rounded-xl border border-[var(--app-border)] bg-[var(--panel-bg)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Pull new model</h2>
          <div className="flex flex-wrap gap-2">
            <input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="min-w-[240px] flex-1 rounded-md border border-[var(--app-border)] bg-transparent px-3 py-2 text-sm"
              placeholder="e.g. llama3.2:latest"
            />
            <button
              onClick={() => pullMutation.mutate(modelName.trim())}
              disabled={!modelName.trim() || pullMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pullMutation.isPending ? "Pulling..." : "Pull"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--muted-fg)]">{pullProgress}</p>
        </section>

        <section className="rounded-xl border border-[var(--app-border)] bg-[var(--panel-bg)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Installed models</h2>
          {isLoading && <p className="text-sm text-[var(--muted-fg)]">Loading models...</p>}
          {error && <p className="text-sm text-red-500">Could not load model list.</p>}
          {!isLoading && !error && sorted.length === 0 && (
            <p className="text-sm text-[var(--muted-fg)]">No local models found yet.</p>
          )}
          <ul className="space-y-2">
            {sorted.map((model) => (
              <li key={model.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2">
                <div>
                  <p className="font-medium">{model.name}</p>
                  <p className="text-xs text-[var(--muted-fg)]">{model.sizeLabel} • {model.tagsLabel}</p>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(model.name)}
                  className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
