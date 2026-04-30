import { useEffect, useState } from "react";
import { Square, Plus, Pencil, Trash2 } from "lucide-react";
import { useProfileStore } from "../stores/profile-store";
import { useRuntimeStore } from "../stores/runtime-store";
import { useSettingsStore, LLM_PROVIDERS } from "../stores/settings-store";
import { refreshStorageUsage, startAgent, stopAgent } from "@/core/orchestrator";
import type { Profile } from "@/core/profiles";
import { ProfileEditor } from "./ProfileEditor";
import { mascotForAccentColor } from "../mascots";
import { destroyWorkspace } from "@/core/workspace";
import { clearProfileCredentials, loadProfileCredentials } from "@/core/credential-vault";

const STATUS_DOT_COLOR: Record<string, string> = {
  idle: "#444",
  booting: "#fbbf24",
  installing: "#fbbf24",
  running: "#34d399",
  error: "#f87171",
  stopped: "#444",
};
const MAX_PROFILE_COUNT = 5;

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/** Sparkle (Material 960 grid); spins with parent `group` on hover. */
function AiStarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={11}
      height={11}
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden
      focusable={false}
    >
      <path d="M480-80q-6,0-11-4t-7-10q-17-67-51-126T328-328T220-411T94-462q-6-2-10-7t-4-11t4-11t10-7q67-17 126-51t108-83t83-108t51-126q2-6 7-10t11-4t10.5,4t6.5,10q18,67 52,126t83,108t108,83t126,51q6,2 10,7t4,11t-4,11t-10,7q-67,17-126,51T632-328T549-220T498-94q-2,6-7,10t-11,4Z" />
    </svg>
  );
}

function providerRequiresUserApiKey(providerId: string): boolean {
  return LLM_PROVIDERS.find((lp) => lp.id === providerId)?.requiresUserApiKey ?? true;
}

export function ProfileSelector() {
  const {
    profiles,
    activeProfileId,
    loaded,
    loadProfiles,
    setActiveProfile,
    removeProfile,
  } = useProfileStore();
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const runningProfileIds = useRuntimeStore((s) => s.runningProfileIds);
  const profileRuntime = useRuntimeStore((s) => s.profileRuntime);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [hoveredProfileId, setHoveredProfileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Profile IDs whose provider needs a user API key but none is configured (vault + global settings). */
  const [missingApiKeyIds, setMissingApiKeyIds] = useState<Set<string>>(new Set());
  const [credentialRefreshTick, setCredentialRefreshTick] = useState(0);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        profiles.map(async (p) => {
          if (!providerRequiresUserApiKey(p.provider)) {
            return { missing: false as const };
          }
          if (apiKeys[p.provider]?.trim()) {
            return { missing: false as const };
          }
          const creds = await loadProfileCredentials(p.id);
          return { missing: !creds.apiKey?.trim() };
        })
      );
      if (cancelled) return;
      const next = new Set<string>();
      results.forEach((r, i) => {
        if (r.missing) next.add(profiles[i]!.id);
      });
      setMissingApiKeyIds(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [profiles, apiKeys, credentialRefreshTick]);

  const hasReachedCap = runningProfileIds.length >= 4;
  const hasReachedProfileLimit = profiles.length >= MAX_PROFILE_COUNT;

  const handleSelectProfile = (profileId: string) => {
    if (activeProfileId === profileId) return;
    setActiveProfile(profileId);
  };

  const handleCardLaunch = async (profileId: string) => {
    const isThisRunning = runningProfileIds.includes(profileId);
    if (isThisRunning) {
      await stopAgent(profileId);
    } else {
      await startAgent(profileId);
    }
  };

  const openNew = () => {
    if (hasReachedProfileLimit) return;
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (p: Profile) => {
    setEditing(p);
    setEditorOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, profileId: string) => {
    e.stopPropagation();
    setConfirmDeleteId(profileId);
  };

  const handleDeleteConfirm = async (e: React.MouseEvent, profileId: string) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
    await removeProfile(profileId);
    await Promise.all([
      destroyWorkspace(profileId).catch(() => {}),
      clearProfileCredentials(profileId).catch(() => {}),
    ]);
    void refreshStorageUsage();
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
  };

  if (!loaded) {
    return (
      <p className="text-[11px] text-text-muted">Loading profiles…</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-text-secondary">Profiles</p>
        <button
          type="button"
          disabled={hasReachedProfileLimit}
          onClick={openNew}
          className="flex items-center gap-1 rounded border border-border-subtle px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:border-white hover:text-text-primary disabled:opacity-40"
          title={hasReachedProfileLimit ? `Max of ${MAX_PROFILE_COUNT} agents reached` : undefined}
        >
          <Plus size={12} strokeWidth={1.5} />
          New
        </button>
      </div>

      {profiles.map((p) => {
        const runtimeStatus = profileRuntime[p.id]?.runtimeStatus ?? "idle";
        const isActive = activeProfileId === p.id;
        const isThisRunning = runningProfileIds.includes(p.id);
        const anyBusy = runtimeStatus === "booting" || runtimeStatus === "installing";
        const isThisBusy = isThisRunning && anyBusy;
        const cardStatus = isThisRunning ? runtimeStatus : "idle";
        const cardBorder = isActive ? p.accentColor : "var(--color-border)";
        const baseBackground = isActive || isThisRunning
          ? "rgba(17, 17, 17, 1)"
          : "var(--color-bg-primary)";
        const hoverBackground = "rgba(24, 24, 24, 1)";

        return (
          <div
            key={p.id}
            data-active-profile={isActive ? "true" : "false"}
            className="relative w-full text-left transition-all"
            role="button"
            tabIndex={0}
            onClick={() => void handleSelectProfile(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void handleSelectProfile(p.id);
              }
            }}
            onMouseEnter={() => setHoveredProfileId(p.id)}
            onMouseLeave={() => setHoveredProfileId((current) => (current === p.id ? null : current))}
            style={{
              padding: "12px 14px",
              borderRadius: "3px",
              border: `1px solid ${cardBorder}`,
              background: hoveredProfileId === p.id ? hoverBackground : baseBackground,
              boxShadow: isActive ? "0 0 16px var(--color-glow-subtle)" : "none",
              opacity: !isActive && !isThisRunning && anyBusy ? 0.5 : 1,
            }}
          >
            <span
              className="absolute right-3 top-3 inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: STATUS_DOT_COLOR[cardStatus],
              }}
            />
            <button
              type="button"
              disabled={false}
              onClick={() => void handleSelectProfile(p.id)}
              className="flex w-full flex-col text-left"
            >
              <div className="flex items-start gap-2">
                <img
                  src={mascotForAccentColor(p.accentColor)}
                  alt=""
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">{p.name}</p>
                  <p
                    className="mt-0.5 text-[10px] leading-snug text-text-muted"
                    style={{
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {truncate(p.personality, 120)}
                  </p>
                </div>
              </div>
            </button>
            <div className="mt-[10px] flex flex-col gap-1">
              {confirmDeleteId === p.id ? (
                <div
                  className="flex items-center gap-1.5 rounded px-2 py-1.5"
                  style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="flex-1 text-[10px] text-red-300">Delete {p.name} and all memory?</span>
                  <button
                    type="button"
                    onClick={(e) => void handleDeleteConfirm(e, p.id)}
                    className="rounded px-2 py-0.5 text-[10px] font-medium text-red-300 transition-colors hover:bg-red-400/20 hover:text-red-200"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteCancel}
                    className="rounded px-2 py-0.5 text-[10px] text-text-muted transition-colors hover:text-text-primary"
                  >
                    No
                  </button>
                </div>
              ) : (
              <div className="flex items-center gap-1">
              {missingApiKeyIds.has(p.id) ? (
                <span className="api-key-alert-ring relative inline-flex rounded-[4px] p-px">
                  <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[3px]">
                    <span className="api-key-alert-spin" aria-hidden />
                  </span>
                  <button
                    type="button"
                    aria-label={`Edit ${p.name}`}
                    title="API key required — open editor to add your key"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(p);
                    }}
                    className="relative z-10 flex items-center rounded-[2px] border-0 bg-bg-primary px-2 py-1 text-[10px] text-brand-magenta-light transition-colors hover:bg-bg-elevated hover:text-text-primary"
                  >
                    <Pencil size={11} strokeWidth={1.5} />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Edit ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(p);
                  }}
                  className="flex items-center rounded border border-border-subtle px-2 py-1 text-[10px] text-text-muted transition-colors hover:border-white hover:text-text-primary"
                >
                  <Pencil size={11} strokeWidth={1.5} />
                </button>
              )}
              {profiles.length > 1 && (
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  disabled={isThisRunning}
                  onClick={(e) => handleDeleteClick(e, p.id)}
                  className="flex items-center rounded border border-border-subtle px-2 py-1 text-[10px] text-text-muted transition-colors hover:border-white hover:text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={11} strokeWidth={1.5} />
                </button>
              )}
              <button
                type="button"
                disabled={isThisBusy || (!isThisRunning && hasReachedCap)}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleCardLaunch(p.id);
                }}
                className="group ml-auto flex items-center gap-1 rounded border border-border-subtle px-2 py-1 text-[10px] font-medium transition-colors hover:border-white hover:text-text-primary disabled:opacity-40"
                style={{
                  color: isThisRunning ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                }}
                title={!isThisRunning && hasReachedCap ? "Cap of 4 concurrent agents reached" : undefined}
              >
                {isThisRunning && !isThisBusy ? (
                  <>
                    <Square size={11} strokeWidth={1.5} className="transition-colors group-hover:text-white" />
                    Stop
                  </>
                ) : isThisBusy ? (
                  <>
                    <span className="inline-block h-2 w-2 animate-spin rounded-full border border-text-muted border-t-text-secondary" />
                    Booting
                  </>
                ) : (
                  <>
                    <AiStarIcon className="shrink-0 text-white transition-colors motion-reduce:group-hover:[animation:none] group-hover:[animation:profile-start-star-burst_2.4s_cubic-bezier(0.45,0,0.55,1)_infinite]" />
                    <span className="text-white">Start</span>
                  </>
                )}
              </button>
              </div>
              )}
            </div>
          </div>
        );
      })}


      <ProfileEditor
        open={editorOpen}
        editing={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
          void loadProfiles();
          setCredentialRefreshTick((t) => t + 1);
        }}
      />
    </div>
  );
}
