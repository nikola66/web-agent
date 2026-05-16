import { Bot, Settings, FolderOpen } from "lucide-react";
import { useSettingsStore, type SidebarView } from "../stores/settings-store";
import { ProfileSelector } from "./ProfileSelector";
import { SettingsPanel } from "./Settings";
import { WorkspacePanel } from "./WorkspacePanel";

const NAV_ITEMS: { id: SidebarView; icon: typeof Bot; label: string }[] = [
  { id: "profiles", icon: Bot, label: "Profiles" },
  { id: "settings", icon: Settings, label: "Settings" },
  { id: "workspaces", icon: FolderOpen, label: "Workspaces" },
];

export function Sidebar() {
  const { sidebarView, setSidebarView } = useSettingsStore();

  return (
    <div
      className="relative flex h-full w-full shrink-0 flex-col border-r"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div
        className="flex shrink-0 items-center border-b px-3 py-2"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h1 className="shrink-0 text-sm font-semibold tracking-wide text-text-primary">
            Web Agent
          </h1>
          <span
            className="shrink-0 text-[10px] font-normal tabular-nums opacity-[0.32]"
            style={{ color: "var(--color-text-muted)" }}
            aria-hidden
          >
            v{import.meta.env.VITE_APP_VERSION}
          </span>
        </div>
      </div>

      <div
        className="flex shrink-0 flex-wrap gap-0.5 border-b px-2 py-1.5"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSidebarView(id)}
            className="flex min-h-10 touch-manipulation items-center gap-1 rounded-button px-2 py-1 text-[11px] font-medium transition-all"
            style={{
              transitionDuration: "var(--duration-fast)",
              transitionTimingFunction: "var(--ease-out)",
              background:
                sidebarView === id ? "var(--color-bg-elevated)" : "transparent",
              color:
                sidebarView === id
                  ? "var(--color-text-primary)"
                  : "var(--color-text-muted)",
              borderRadius: "var(--radius-button)",
            }}
          >
            <Icon size={12} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>

      <div className="fancy-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {sidebarView === "profiles" && <ProfileSelector />}
        {sidebarView === "settings" && <SettingsPanel />}
        {sidebarView === "workspaces" && <WorkspacePanel />}
      </div>

      <div
        className="flex shrink-0 items-center justify-center gap-4 border-t px-3 py-2 grayscale"
        style={{
          borderColor: "var(--color-border-subtle)",
          color: "var(--color-text-muted)",
        }}
      >
        <a
          href="https://ko-fi.com/nikola66"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 opacity-100 transition-opacity hover:opacity-70"
          aria-label="Support on Ko-fi"
          title="Support on Ko-fi"
        >
          <svg
            role="img"
            aria-hidden
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            className="size-4 shrink-0"
            fill="currentColor"
          >
            <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z" />
          </svg>
          <span className="text-[11px] font-medium">Support</span>
        </a>
        <a
          href="https://github.com/nikola66/web-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-100 transition-opacity hover:opacity-70"
          aria-label="Web Agent on GitHub"
          title="Web Agent on GitHub"
        >
          <svg
            role="img"
            aria-hidden
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            className="size-4"
            fill="currentColor"
          >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
      </div>
    </div>
  );
}
