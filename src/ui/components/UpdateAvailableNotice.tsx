import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  dismissAppUpdate,
  getAppUpdateSnapshot,
  reloadForAppUpdate,
  shouldShowUpdateNotice,
  subscribeAppUpdate,
} from "@/core/app-update";

function subscribe(onStoreChange: () => void): () => void {
  return subscribeAppUpdate(onStoreChange);
}

function getSnapshot(): boolean {
  return shouldShowUpdateNotice();
}

export function UpdateAvailableNotice() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const { remoteBuildId } = getAppUpdateSnapshot();

  if (!visible || !remoteBuildId) return null;

  return (
    <div
      className="mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-sm border p-2.5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-elevated)",
        borderRadius: "var(--radius-sm)",
      }}
      role="status"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-text-primary">
          A new version is available. Reload to get the latest fixes. Your
          profiles and agent memory are kept.
        </p>
        <button
          type="button"
          aria-label="Dismiss update notice"
          className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
          onClick={() => dismissAppUpdate(remoteBuildId)}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <button
        type="button"
        className="w-full rounded-button px-2 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:opacity-90"
        style={{
          background: "var(--color-accent)",
          borderRadius: "var(--radius-button)",
        }}
        onClick={() => void reloadForAppUpdate()}
      >
        Reload for latest version
      </button>
    </div>
  );
}
