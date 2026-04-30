import { useEffect, useRef, useState } from "react";
import { Download, Upload, Trash2, Plus, AlertTriangle } from "lucide-react";
import {
  downloadWorkspace,
  importWorkspace,
  getStorageInfo,
  requestWorkspaceCleanOnceReload,
  destroyAll,
} from "@/core/workspace";
import { useProfileStore } from "../stores/profile-store";
import { useActiveProfileRuntime, useRuntimeStore } from "../stores/runtime-store";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function WorkspacePanel() {
  const { activeProfileId, profiles } = useProfileStore();
  const runtimeStatus = useActiveProfileRuntime().runtimeStatus;
  const [storage, setStorage] = useState({ used: 0, quota: 0, percentage: 0 });
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [nukeStep, setNukeStep] = useState<"idle" | "confirm" | "working">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isRunning =
    runtimeStatus === "running" ||
    runtimeStatus === "booting" ||
    runtimeStatus === "installing";

  const active = profiles.find((p) => p.id === activeProfileId);
  const profileLabel = active?.name ?? "profile";

  const refreshStorage = async () => {
    const updated = await getStorageInfo();
    setStorage(updated);
    useRuntimeStore.getState().setStorageUsed(updated.used);
    return updated;
  };

  useEffect(() => {
    void refreshStorage();
  }, []);

  const handleExport = async () => {
    if (!activeProfileId) return;
    try {
      await downloadWorkspace(activeProfileId);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeProfileId) return;
    try {
      await importWorkspace(activeProfileId, file);
      await refreshStorage();
    } catch (err) {
      console.error("Import failed:", err);
    }
    e.target.value = "";
  };

  const handleDestroy = async () => {
    if (!activeProfileId) return;
    if (!confirmDestroy) {
      setConfirmDestroy(true);
      return;
    }
    requestWorkspaceCleanOnceReload();
    setConfirmDestroy(false);
  };

  const handleNuke = async () => {
    if (nukeStep === "idle") {
      setNukeStep("confirm");
      return;
    }
    if (nukeStep !== "confirm") return;
    setNukeStep("working");
    try {
      await destroyAll();
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-text-secondary">Workspaces</p>
      <p className="text-[10px] leading-relaxed text-text-muted">
        Export or import the selected profile&apos;s workspace snapshot.
      </p>

      <div className="flex flex-col gap-2">
        <ActionButton
          icon={Download}
          label="Export Workspace"
          onClick={handleExport}
          disabled={isRunning || !activeProfileId}
        />
        <ActionButton
          icon={Upload}
          label="Import Workspace"
          onClick={handleImport}
          disabled={isRunning || !activeProfileId}
        />
        <ActionButton
          icon={Trash2}
          label={confirmDestroy ? "Confirm Destroy" : "Destroy Workspace"}
          onClick={handleDestroy}
          destructive
          disabled={isRunning || !activeProfileId}
        />
        {confirmDestroy && (
          <p className="flex items-center gap-1.5 text-[10px] text-yellow-400">
            <AlertTriangle size={11} />
            This reloads with clean=once and clears “{profileLabel}”.
          </p>
        )}
      </div>

      <div
        className="mt-2 flex flex-col gap-1.5 rounded p-3"
        style={{
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        <p className="text-[10px] text-text-muted">
          Browser storage used:{" "}
          <span className="text-text-secondary">{formatBytes(storage.used)}</span>
        </p>
        <p className="text-[10px] text-text-muted">
          Quota:{" "}
          <span className="text-text-secondary">
            {storage.quota > 0 ? formatBytes(storage.quota) : "—"}
          </span>
        </p>
        {storage.percentage > 0 && (
          <div className="mt-1">
            <div
              className="h-1 overflow-hidden rounded-full"
              style={{ background: "var(--color-border-subtle)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(storage.percentage, 100)}%`,
                  background:
                    storage.percentage > 80
                      ? "#f87171"
                      : "linear-gradient(90deg, var(--color-brand-violet), var(--color-brand-magenta-light))",
                  transitionDuration: "var(--duration-slow)",
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <p className="text-xs font-medium text-text-secondary">Danger Zone</p>
        <p className="text-[10px] leading-relaxed text-text-muted mt-1 mb-2">
          Permanently deletes all agents, memory, workspaces, and credentials. Cannot be undone.
        </p>
        {nukeStep === "confirm" && (
          <p
            className="mb-2 flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] text-red-300"
            style={{
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.3)",
            }}
          >
            <Trash2 size={11} strokeWidth={1.5} />
            This will delete everything and reload. Are you sure?
          </p>
        )}
        <button
          type="button"
          disabled={nukeStep === "working"}
          onClick={() => void handleNuke()}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-all disabled:opacity-40"
          style={{
            borderRadius: "var(--radius-button)",
            border: `1px solid ${nukeStep === "confirm" ? "rgba(248,113,113,0.6)" : "var(--color-border-subtle)"}`,
            color: nukeStep === "confirm" ? "#fca5a5" : "var(--color-text-muted)",
            cursor: nukeStep === "working" ? "not-allowed" : "pointer",
            transitionDuration: "var(--duration-fast)",
          }}
          onMouseEnter={(e) => {
            if (nukeStep !== "working") {
              e.currentTarget.style.borderColor = "#f87171";
              e.currentTarget.style.color = "#f87171";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor =
              nukeStep === "confirm" ? "rgba(248,113,113,0.6)" : "var(--color-border-subtle)";
            e.currentTarget.style.color =
              nukeStep === "confirm" ? "#fca5a5" : "var(--color-text-muted)";
          }}
        >
          <Trash2 size={14} strokeWidth={1.5} />
          {nukeStep === "idle"
            ? "Nuke Everything"
            : nukeStep === "confirm"
              ? "Yes, delete everything"
              : "Deleting…"}
        </button>
        {nukeStep === "confirm" && (
          <button
            type="button"
            onClick={() => setNukeStep("idle")}
            className="mt-1.5 w-full text-center text-[10px] text-text-muted transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileSelected}
      />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  disabled = false,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-all"
      style={{
        borderRadius: "var(--radius-button)",
        border: "1px solid var(--color-border-subtle)",
        color: destructive ? "var(--color-text-muted)" : "var(--color-text-secondary)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transitionDuration: "var(--duration-fast)",
        transitionTimingFunction: "var(--ease-out)",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.borderColor = destructive
            ? "#f87171"
            : "var(--color-border-strong)";
          e.currentTarget.style.color = destructive
            ? "#f87171"
            : "var(--color-text-primary)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border-subtle)";
        e.currentTarget.style.color = destructive
          ? "var(--color-text-muted)"
          : "var(--color-text-secondary)";
      }}
    >
      <Icon size={14} strokeWidth={1.5} />
      {label}
    </button>
  );
}
