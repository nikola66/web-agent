import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { profileAgentWorking, useActiveProfileRuntime, useRuntimeStore } from "../stores/runtime-store";
import { useProfileStore } from "../stores/profile-store";
import { TOOL_CATALOG } from "@/agent/tool-catalog";
import { ErrorBoundary } from "./ErrorBoundary";
import { formatBytes } from "../utils/format";

const FilesPopup = lazy(() => import("./FilesPopup").then((m) => ({ default: m.FilesPopup })));

const STATUS_COLORS: Record<string, string> = {
  idle: "#666666",
  booting: "#fbbf24",
  installing: "#fbbf24",
  running: "#34d399",
  error: "#f87171",
  stopped: "#666666",
};

const TOOL_EMOJI: Record<string, string> = Object.entries(TOOL_CATALOG).reduce(
  (acc, [name, meta]) => {
    if (meta?.emoji) acc[name] = meta.emoji;
    return acc;
  },
  {} as Record<string, string>
);

export function StatusBar() {
  const rt = useActiveProfileRuntime();
  const {
    runtimeStatus,
    recentToolCalls,
    modelId,
    contextWindowTokens,
    estimatedPromptTokens,
    awaitingResponse,
    queuedInputs,
  } = rt;
  const agentWorking = profileAgentWorking(rt);
  const queuedCount = queuedInputs.length;
  const workingLabel =
    !awaitingResponse && queuedCount > 0
      ? `${queuedCount} queued — sending soon`
      : queuedCount > 0
        ? `Thinking · ${queuedCount} queued`
        : "Thinking...";
  const storageUsed = useRuntimeStore((s) => s.storageUsed);
  const storagePersistent = useRuntimeStore((s) => s.storagePersistent);
  const { profiles, activeProfileId } = useProfileStore();
  const [filesOpen, setFilesOpen] = useState(false);
  const filesRootRef = useRef<HTMLDivElement>(null);
  const active = profiles.find((p) => p.id === activeProfileId);
  const profileLabel = active?.name ?? "Web Agent";
  const toolCallsTitle = useMemo(() => recentToolCalls.join(", "), [recentToolCalls]);
  const contextUsage = useMemo(() => {
    if (!contextWindowTokens || contextWindowTokens <= 0) return null;
    const used = Math.max(0, estimatedPromptTokens);
    const ratio = Math.min(1, used / contextWindowTokens);
    return {
      ratio,
      used,
      total: contextWindowTokens,
    };
  }, [contextWindowTokens, estimatedPromptTokens]);

  useEffect(() => {
    if (!filesOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!filesRootRef.current?.contains(event.target as Node)) {
        setFilesOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilesOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [filesOpen]);

  return (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 px-0 py-1">
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{
            background: STATUS_COLORS[runtimeStatus],
            boxShadow: agentWorking ? `0 0 6px ${STATUS_COLORS.running}` : undefined,
          }}
        />
        <span className="shrink-0 text-[11px] font-medium text-text-secondary">{profileLabel}</span>
      </div>

      {recentToolCalls.length > 0 ? (
        <>
          <span className="shrink-0 text-text-muted">·</span>
          <span
            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] leading-none text-text-muted"
            title={toolCallsTitle}
            aria-label="Recent tool calls"
          >
            {recentToolCalls.map((tool, i) => (
              <span key={`${i}:${tool}`} className="inline-block shrink-0" title={tool}>
                {TOOL_EMOJI[tool] ?? "🛠️"}
              </span>
            ))}
          </span>
        </>
      ) : null}

      {agentWorking ? (
        <>
          <span className="shrink-0 text-text-muted">·</span>
          <div
            className="inline-flex min-h-5 shrink-0 items-center gap-1.5"
            aria-live="polite"
            aria-busy="true"
            role="status"
            data-testid="agent-working-indicator"
          >
            <span className="webagent-thinking-dots inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="shrink-0 text-[11px] font-medium tracking-wide text-brand-magenta-light/95">
              {workingLabel}
            </span>
          </div>
        </>
      ) : null}

      <div className="min-w-0 flex-1" />

      {storageUsed > 0 && (
        <span className="text-[11px] text-text-muted">{formatBytes(storageUsed)}</span>
      )}

      <div className="relative" ref={filesRootRef}>
        <button
          type="button"
          onClick={() => setFilesOpen((open) => !open)}
          disabled={!activeProfileId}
          className="inline-flex h-4 w-4 items-center justify-center text-text-muted transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Open files popup"
          title="Files"
        >
          <Folder size={12} strokeWidth={1.7} />
        </button>
        {filesOpen && activeProfileId && (
          <ErrorBoundary label="Files panel" onReset={() => setFilesOpen(false)}>
            <Suspense fallback={null}>
              <FilesPopup profileId={activeProfileId} onClose={() => setFilesOpen(false)} />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>

      {contextUsage && (
        <span
          className="inline-flex items-center text-text-muted"
          title={`${modelId ?? "model"} context: ${contextUsage.used.toLocaleString()} / ${contextUsage.total.toLocaleString()} tokens`}
          aria-label={`${Math.round(contextUsage.ratio * 100)}% context used`}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 8}`}
              strokeDashoffset={`${(1 - contextUsage.ratio) * 2 * Math.PI * 8}`}
              transform="rotate(-90 10 10)"
            />
          </svg>
        </span>
      )}

      {storagePersistent === false && (
        <span
          className="text-[11px] text-text-muted"
          title="Browser persistence was not granted. Export important workspaces before clearing site data or freeing disk space."
        >
          Ephemeral storage
        </span>
      )}
    </div>
  );
}
