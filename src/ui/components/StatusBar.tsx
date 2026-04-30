import { useEffect, useMemo, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { profileAgentWorking, useActiveProfileRuntime, useRuntimeStore } from "../stores/runtime-store";
import { useProfileStore } from "../stores/profile-store";
import { TOOL_CATALOG } from "@/agent/tool-catalog";
import { FilesPopup } from "./FilesPopup";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

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
  } = rt;
  const agentWorking = profileAgentWorking(rt);
  const { storageUsed, storagePersistent } = useRuntimeStore();
  const { profiles, activeProfileId } = useProfileStore();
  const [filesOpen, setFilesOpen] = useState(false);
  const filesRootRef = useRef<HTMLDivElement>(null);
  const active = profiles.find((p) => p.id === activeProfileId);
  const profileLabel = active?.name ?? "Web Agent";
  const toolEmojis = useMemo(
    () => recentToolCalls.map((tool: string) => TOOL_EMOJI[tool] ?? "🛠️").join(" "),
    [recentToolCalls]
  );
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
    <div className="flex shrink-0 items-center gap-3 px-0 py-1">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{
            background: STATUS_COLORS[runtimeStatus],
            boxShadow: agentWorking ? `0 0 6px ${STATUS_COLORS.running}` : undefined,
          }}
        />
        <span className="text-[11px] font-medium text-text-secondary">
          {profileLabel}
        </span>
      </div>

      {toolEmojis && (
        <>
          <span className="text-text-muted">·</span>
          <span
            className="text-[11px] text-text-muted"
            title={recentToolCalls.join(", ")}
            aria-label="Recent tool calls"
          >
            {toolEmojis}
          </span>
        </>
      )}

      <div className="flex-1" />

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
          <FilesPopup profileId={activeProfileId} onClose={() => setFilesOpen(false)} />
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
