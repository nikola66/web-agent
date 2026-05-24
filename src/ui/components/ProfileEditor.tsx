import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Eye, EyeOff, Trash2, Pencil } from "lucide-react";
import { useProfileStore } from "../stores/profile-store";
import {
  useActiveProfileRuntime,
  useProfileRuntime,
  useRuntimeStore,
} from "../stores/runtime-store";
import { startAgent, stopAgent } from "@/core/orchestrator";
import { createAgentName, type Profile } from "@/core/profiles";
import {
  type ProviderModelOverrides,
  buildProviderModelsFromProfile,
  resolveProviderModelOverride,
  storeProviderModelOverride,
} from "@/core/profile-provider-models";
import {
  DEFAULT_EDGE_TTS_VOICE,
  EDGE_TTS_LOCALE_LABEL,
  fetchEdgeTtsVoices,
  formatEdgeTtsVoiceOption,
  resolveProfileTtsVoice,
  type EdgeTtsVoiceOption,
} from "@/core/voice/edge-tts-client";
import { LLM_PROVIDERS, useSettingsStore } from "../stores/settings-store";
import { loadProfileCredentials, saveProfileCredentials } from "@/core/credential-vault";
import { DEFAULT_PROVIDER_ID } from "@/core/providers";
import { DEFAULT_ACCENT_COLOR, PRESET_ACCENT_COLORS, randomAccentColor } from "@/core/mascots";
import {
  DEFAULT_PERSONALITY_PRESET_ID,
  getDefaultPersonalityPrompt,
  listPersonalityPresets,
} from "@/core/personalities";
import { CHANNELS } from "@/core/channels";
import { SearchableSelect } from "./SearchableSelect";
import {
  fetchSubscriptionAuthStatus,
  isSubscriptionOAuthProvider,
  logoutSubscriptionProfile,
  pollSubscriptionOAuth,
  startSubscriptionOAuth,
  type DeviceOAuthSession,
  type SubscriptionAuthStatus,
  type SubscriptionOAuthProviderId,
} from "@/core/subscription-auth-client";

const PROVIDERS: Profile["provider"][] = LLM_PROVIDERS.map((provider) => provider.id);
const PERSONALITY_PRESETS = listPersonalityPresets();
const CUSTOM_PERSONALITY_OPTION = "__custom__";
const PERSONALITY_OPTIONS = [
  ...PERSONALITY_PRESETS.map((preset) => ({ value: preset.id, label: preset.name })),
  { value: CUSTOM_PERSONALITY_OPTION, label: "Custom" },
];
const PROVIDER_OPTIONS = PROVIDERS.map((providerId) => ({
  value: providerId,
  label: LLM_PROVIDERS.find((providerOption) => providerOption.id === providerId)?.label || providerId,
}));
const isKnownProvider = (providerId: string): providerId is Profile["provider"] =>
  PROVIDERS.includes(providerId as Profile["provider"]);

/** Sidebar uses `transform`, which traps `fixed` — portal on desktop so the dialog centers on the viewport. */
const PROFILE_EDITOR_VIEWPORT_PORTAL_MQ = "(min-width: 768px)";

function Field(props: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-[11px] font-medium text-text-secondary">{props.label}</label>
      {props.children}
    </div>
  );
}

export function ProfileEditor(props: {
  open: boolean;
  onClose: () => void;
  /** null = create */
  editing: Profile | null;
}) {
  type EditorTab = "profile" | "channels";
  const { open, onClose, editing } = props;
  const { profiles, createProfile, updateProfile } = useProfileStore();
  const runtimeStatus = useActiveProfileRuntime().runtimeStatus;
  const runningProfileIds = useRuntimeStore((s) => s.runningProfileIds);
  const editedProfileId = editing?.id ?? null;
  const editedRuntime = useProfileRuntime(editedProfileId);
  const saveImpliesReboot =
    editedProfileId !== null &&
    (runningProfileIds.includes(editedProfileId) ||
      editedRuntime.runtimeStatus === "running" ||
      editedRuntime.runtimeStatus === "booting");

  const [name, setName] = useState("");
  const [userName, setUserName] = useState("");
  const [personalityPresetId, setPersonalityPresetId] = useState(DEFAULT_PERSONALITY_PRESET_ID);
  const [personality, setPersonality] = useState("");
  const [provider, setProvider] = useState<Profile["provider"]>(DEFAULT_PROVIDER_ID);
  const [model, setModel] = useState("");
  const [providerModels, setProviderModels] = useState<ProviderModelOverrides>({});
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [ttsVoice, setTtsVoice] = useState(DEFAULT_EDGE_TTS_VOICE);
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<EdgeTtsVoiceOption[]>([]);
  const [ttsVoicesLoading, setTtsVoicesLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [channelTokens, setChannelTokens] = useState<Record<string, string>>({});
  const [channelTokenVisible, setChannelTokenVisible] = useState<Record<string, boolean>>({});
  const [personalityExpanded, setPersonalityExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>("profile");
  const [draftProfileId, setDraftProfileId] = useState(() => crypto.randomUUID());
  const [portalEditorToBody, setPortalEditorToBody] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PROFILE_EDITOR_VIEWPORT_PORTAL_MQ).matches
  );

  useLayoutEffect(() => {
    const mq = window.matchMedia(PROFILE_EDITOR_VIEWPORT_PORTAL_MQ);
    const sync = () => setPortalEditorToBody(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTtsVoicesLoading(true);
    void fetchEdgeTtsVoices()
      .then((voices) => {
        if (!cancelled) setTtsVoiceOptions(voices);
      })
      .catch(() => {
        if (!cancelled) setTtsVoiceOptions([]);
      })
      .finally(() => {
        if (!cancelled) setTtsVoicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPersonalityExpanded(false);
    setActiveTab("profile");
    if (!editing) setDraftProfileId(crypto.randomUUID());
    (async () => {
      if (editing) {
        setName(editing.name);
        setUserName(editing.userName || "User");
        setPersonality(editing.personality);
        const matchingPreset = PERSONALITY_PRESETS.find(
          (preset) => preset.prompt === editing.personality
        );
        setPersonalityPresetId(matchingPreset?.id ?? CUSTOM_PERSONALITY_OPTION);
        setProvider(isKnownProvider(editing.provider) ? editing.provider : DEFAULT_PROVIDER_ID);
        const loadedProvider = isKnownProvider(editing.provider) ? editing.provider : DEFAULT_PROVIDER_ID;
        const loadedProviderModels = buildProviderModelsFromProfile(
          editing,
          LLM_PROVIDERS.find((p) => p.id === loadedProvider)?.model?.trim() ?? ""
        );
        setProviderModels(loadedProviderModels);
        setModel(
          resolveProviderModelOverride(
            loadedProvider,
            loadedProviderModels,
            LLM_PROVIDERS.find((p) => p.id === loadedProvider)?.model?.trim() ?? ""
          )
        );
        setAccentColor(editing.accentColor);
        setTtsVoice(resolveProfileTtsVoice(editing));
        const creds = await loadProfileCredentials(editing.id);
        setApiKey(creds.apiKey || "");
        setCustomBaseUrl(creds.customBaseUrl || "");
        setChannelTokens(creds.channelTokens || {});
      } else {
        setName(createAgentName(profiles.map((p) => p.name)));
        setUserName("User");
        setPersonalityPresetId(DEFAULT_PERSONALITY_PRESET_ID);
        setPersonality(getDefaultPersonalityPrompt());
        setProvider(DEFAULT_PROVIDER_ID);
        setModel("");
        setProviderModels({});
        setAccentColor(randomAccentColor());
        setTtsVoice(DEFAULT_EDGE_TTS_VOICE);
        setApiKey("");
        setCustomBaseUrl("");
        setChannelTokens({});
      }
    })();
  }, [open, editing?.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const profileScopeId = editing?.id ?? draftProfileId;

  const providerDefaultModel = (providerId: string) =>
    LLM_PROVIDERS.find((p) => p.id === providerId)?.model?.trim() ?? "";

  const save = async () => {
    const finalProviderModels = storeProviderModelOverride(
      providerModels,
      provider,
      model,
      providerDefaultModel(provider)
    );
    const activeModelOverride = resolveProviderModelOverride(
      provider,
      finalProviderModels,
      providerDefaultModel(provider)
    );
    let profileId: string;
    if (editing) {
      profileId = editing.id;
      await updateProfile(editing.id, {
        name,
        userName,
        personality,
        provider,
        model: activeModelOverride,
        providerModels: finalProviderModels,
        accentColor,
        ttsVoice,
      });
    } else {
      const keepActiveProfile =
        runtimeStatus === "running" ||
        runtimeStatus === "booting" ||
        runningProfileIds.length > 0;
      const created = await createProfile({
        name,
        userName,
        personality,
        provider,
        model: activeModelOverride,
        providerModels: finalProviderModels,
        accentColor,
        ttsVoice,
      }, { setActive: !keepActiveProfile, id: draftProfileId });
      profileId = created.id;
    }
    // Filter out empty channel tokens
    const nonEmptyChannelTokens = Object.fromEntries(
      Object.entries(channelTokens).filter(([_, v]) => v.trim())
    );
    await saveProfileCredentials(profileId, {
      apiKey: apiKey.trim() || undefined,
      customBaseUrl: customBaseUrl.trim() || undefined,
      channelTokens: Object.keys(nonEmptyChannelTokens).length > 0 ? nonEmptyChannelTokens : undefined,
    });
    onClose();
    if (saveImpliesReboot) {
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        useSettingsStore.getState().setSidebarOpen(false);
      }
      await stopAgent(profileId);
      await startAgent(profileId);
    }
  };

  const providerDefaultModelPlaceholder =
    LLM_PROVIDERS.find((p) => p.id === provider)?.model?.trim() || "Default";

  const onProviderChange = (nextProvider: string) => {
    const updatedProviderModels = storeProviderModelOverride(
      providerModels,
      provider,
      model,
      providerDefaultModel(provider)
    );
    setProviderModels(updatedProviderModels);
    setProvider(nextProvider as Profile["provider"]);
    setModel(
      resolveProviderModelOverride(
        nextProvider,
        updatedProviderModels,
        providerDefaultModel(nextProvider)
      )
    );
  };

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Edit profile" : "New profile"}
    >
      <div
        className="fancy-scroll relative flex max-h-[90vh] w-full max-w-md flex-col gap-2.5 overflow-y-auto p-3"
        style={{
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          boxShadow: "0 0 40px rgba(0,0,0,0.4)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-text-muted hover:text-text-primary"
          aria-label="Close"
        >
          <X size={16} strokeWidth={1.5} />
        </button>

        <div className="flex gap-1.5">
          {[
            { id: "profile", label: "Profile" },
            { id: "channels", label: "Channels" },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as EditorTab)}
                className="rounded px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  border: "1px solid var(--color-border)",
                  background: isActive ? "var(--color-bg-primary)" : "transparent",
                  color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
                }}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "profile" ? (
          <>
            <div
              className="flex flex-col"
              style={{ marginTop: "15px", rowGap: "15px" }}
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-transparent px-2.5 py-1.5 text-xs text-text-primary outline-none"
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </Field>
                <Field label="Your name">
                  <input
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full bg-transparent px-2.5 py-1.5 text-xs text-text-primary outline-none"
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-text-secondary">
                    Personality / system prompt
                  </label>
                  <button
                    type="button"
                    onClick={() => setPersonalityExpanded((v) => !v)}
                    className="flex items-center gap-1 rounded p-1 text-[10px] text-text-muted hover:text-text-primary"
                    aria-expanded={personalityExpanded}
                    aria-label={personalityExpanded ? "Hide system prompt" : "Edit system prompt"}
                    title={personalityExpanded ? "Hide system prompt" : "Edit system prompt"}
                  >
                    <Pencil size={12} strokeWidth={1.5} />
                    <span>{personalityExpanded ? "Hide" : "Edit"}</span>
                  </button>
                </div>
                <SearchableSelect
                  value={personalityPresetId}
                  options={PERSONALITY_OPTIONS}
                  searchPlaceholder="Search personality..."
                  onChange={(nextPresetId) => {
                    setPersonalityPresetId(nextPresetId);
                    const selectedPreset = PERSONALITY_PRESETS.find(
                      (preset) => preset.id === nextPresetId
                    );
                    if (selectedPreset) {
                      setPersonality(selectedPreset.prompt);
                    }
                  }}
                />
                {personalityExpanded && (
                  <textarea
                    value={personality}
                    onChange={(e) => {
                      const nextPrompt = e.target.value;
                      setPersonality(nextPrompt);
                      const matchingPreset = PERSONALITY_PRESETS.find(
                        (preset) => preset.prompt === nextPrompt
                      );
                      setPersonalityPresetId(matchingPreset?.id ?? CUSTOM_PERSONALITY_OPTION);
                    }}
                    rows={6}
                    className="resize-y bg-transparent px-2.5 py-1.5 text-xs leading-relaxed text-text-primary outline-none"
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      minHeight: "110px",
                    }}
                  />
                )}
              </div>

              {provider === "opencode" ? (
                <Field label="Provider">
                  <SearchableSelect
                    value={provider}
                    options={PROVIDER_OPTIONS}
                    searchPlaceholder="Search provider..."
                    className="w-full"
                    onChange={onProviderChange}
                  />
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Provider">
                    <SearchableSelect
                      value={provider}
                      options={PROVIDER_OPTIONS}
                      searchPlaceholder="Search provider..."
                      className="w-full"
                      onChange={onProviderChange}
                    />
                  </Field>
                  <Field label="Model override">
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={providerDefaultModelPlaceholder}
                      aria-label="Model override"
                      className="w-full bg-transparent px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
                      style={{
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    />
                  </Field>
                </div>
              )}

              {(() => {
                const selectedProvider = LLM_PROVIDERS.find((p) => p.id === provider);
                const requiresKey = selectedProvider?.requiresUserApiKey;
                const isCustom = provider === "custom";

                return (
                  <>
                    {isCustom && (
                      <Field label="Base URL (optional)">
                        <input
                          type="text"
                          placeholder="https://api.example.com/v1"
                          value={customBaseUrl}
                          onChange={(e) => setCustomBaseUrl(e.target.value)}
                          className="w-full bg-transparent px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
                          style={{
                            border: "1px solid var(--color-border)",
                            borderRadius: "var(--radius-sm)",
                          }}
                        />
                      </Field>
                    )}
                    {requiresKey && (
                      <Field
                        label={
                          <span className="flex items-center gap-1.5">
                            <span>API Key</span>
                            {selectedProvider?.getKeyUrl ? (
                              <a
                                href={selectedProvider.getKeyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-normal text-text-muted underline decoration-dotted underline-offset-2 hover:text-text-primary"
                              >
                                Get key
                              </a>
                            ) : null}
                          </span>
                        }
                      >
                        <div className="flex gap-1.5">
                          <div className="relative flex-1">
                            <input
                              type={apiKeyVisible ? "text" : "password"}
                              placeholder={selectedProvider?.placeholder || "Enter API key"}
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              className="w-full bg-transparent px-2.5 py-1.5 text-xs text-text-primary outline-none transition-all placeholder:text-text-muted"
                              style={{
                                border: "1px solid var(--color-border)",
                                borderRadius: "var(--radius-sm)",
                                transitionDuration: "var(--duration-fast)",
                              }}
                              onFocus={(e) => {
                                e.currentTarget.style.borderColor =
                                  "var(--color-brand-magenta-light)";
                                e.currentTarget.style.boxShadow =
                                  "0 0 15px var(--color-glow-subtle)";
                              }}
                              onBlur={(e) => {
                                e.currentTarget.style.borderColor = "var(--color-border)";
                                e.currentTarget.style.boxShadow = "none";
                              }}
                            />
                          </div>
                          {apiKey && (
                            <>
                              <button
                                type="button"
                                onClick={() => setApiKeyVisible(!apiKeyVisible)}
                                className="rounded-sm p-1.5 text-text-muted transition-colors hover:text-text-primary"
                                style={{
                                  borderRadius: "var(--radius-sm)",
                                  transitionDuration: "var(--duration-fast)",
                                }}
                              >
                                {apiKeyVisible ? (
                                  <EyeOff size={14} strokeWidth={1.5} />
                                ) : (
                                  <Eye size={14} strokeWidth={1.5} />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setApiKey("")}
                                className="rounded-sm p-1.5 text-text-muted transition-colors hover:text-red-400"
                                style={{
                                  borderRadius: "var(--radius-sm)",
                                  transitionDuration: "var(--duration-fast)",
                                }}
                              >
                                <Trash2 size={14} strokeWidth={1.5} />
                              </button>
                            </>
                          )}
                        </div>
                      </Field>
                    )}
                    {isSubscriptionOAuthProvider(provider) ? (
                      <SubscriptionProviderAuth
                        providerId={provider}
                        profileId={profileScopeId}
                        open={open}
                      />
                    ) : null}
                  </>
                );
              })()}

              <Field
                label={
                  <span className="flex items-center justify-between gap-2">
                    <span>Voice</span>
                    <span className="font-normal text-text-muted">{EDGE_TTS_LOCALE_LABEL}</span>
                  </span>
                }
              >
                <SearchableSelect
                  value={ttsVoice}
                  options={
                    ttsVoiceOptions.length > 0
                      ? ttsVoiceOptions.map((v) => ({
                          value: v.id,
                          label: formatEdgeTtsVoiceOption(v),
                        }))
                      : [{ value: ttsVoice, label: ttsVoice.replace(/^en-US-/, "").replace(/Neural.*$/i, "") }]
                  }
                  searchPlaceholder={ttsVoicesLoading ? "Loading voices…" : "Search voice…"}
                  className="w-full"
                  onChange={setTtsVoice}
                />
              </Field>

              <Field label="Accent">
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_ACCENT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAccentColor(c)}
                      className="h-6 w-6 rounded border-2 transition-transform hover:scale-110"
                      style={{
                        background: c,
                        borderColor: accentColor === c ? "#fff" : "transparent",
                      }}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </Field>
            </div>
          </>
        ) : (
          <div style={{ marginTop: "15px", display: "flex", flexDirection: "column", gap: "15px" }}>
            {CHANNELS.filter(ch => ch.auth).map((channel) => {
              const token = channelTokens[channel.id] || "";
              const isVisible = channelTokenVisible[channel.id] || false;
              return (
                <Field
                  key={channel.id}
                  label={
                    <>
                      {channel.name}
                      {channel.docsUrl ? (
                        <>
                          {" · "}
                          <a
                            href={channel.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-normal underline underline-offset-2 hover:text-text-primary"
                          >
                            Setup tutorial
                          </a>
                        </>
                      ) : null}
                    </>
                  }
                >
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <input
                        type={isVisible ? "text" : "password"}
                        placeholder="Optional"
                        value={token}
                        onChange={(e) =>
                          setChannelTokens((prev) => ({
                            ...prev,
                            [channel.id]: e.target.value,
                          }))
                        }
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-transparent px-2.5 py-1.5 text-xs text-text-primary outline-none transition-all placeholder:text-text-muted"
                        style={{
                          border: "1px solid var(--color-border)",
                          borderRadius: "var(--radius-sm)",
                          transitionDuration: "var(--duration-fast)",
                        }}
                      />
                    </div>
                    {token ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setChannelTokenVisible((prev) => ({
                              ...prev,
                              [channel.id]: !isVisible,
                            }))
                          }
                          className="rounded-sm p-1.5 text-text-muted transition-colors hover:text-text-primary"
                          aria-label={isVisible ? "Hide token" : "Show token"}
                        >
                          {isVisible ? (
                            <EyeOff size={14} strokeWidth={1.5} />
                          ) : (
                            <Eye size={14} strokeWidth={1.5} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setChannelTokens((prev) => ({
                              ...prev,
                              [channel.id]: "",
                            }))
                          }
                          className="rounded-sm p-1.5 text-text-muted transition-colors hover:text-red-400"
                          aria-label={`Clear ${channel.name} token`}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </Field>
              );
            })}
          </div>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary"
            style={{ border: "1px solid var(--color-border)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            className="rounded px-4 py-1.5 text-xs font-semibold text-white"
            style={{
              background: "var(--color-cta)",
              boxShadow: "0 0 16px rgba(190, 50, 214, 0.35)",
            }}
          >
            {saveImpliesReboot ? "Save & Reboot" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );

  return portalEditorToBody ? createPortal(dialog, document.body) : dialog;
}

type DeviceOAuthSessionLocal = DeviceOAuthSession;

const SUBSCRIPTION_PROVIDER_LABELS: Record<
  SubscriptionOAuthProviderId,
  { field: string; login: string; connected: string }
> = {
  nous: {
    field: "Nous subscription",
    login: "Log in with Nous",
    connected: "Connected",
  },
  "openai-codex": {
    field: "Codex (OpenAI subscription)",
    login: "Log in with Codex",
    connected: "Connected",
  },
};

function SubscriptionProviderAuth(props: {
  providerId: SubscriptionOAuthProviderId;
  profileId: string;
  open: boolean;
}) {
  const { providerId, profileId, open } = props;
  const labels = SUBSCRIPTION_PROVIDER_LABELS[providerId];
  const [status, setStatus] = useState<SubscriptionAuthStatus | null>(null);
  const [deviceSession, setDeviceSession] = useState<DeviceOAuthSessionLocal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshStatus = async () => {
    const result = await fetchSubscriptionAuthStatus(providerId, profileId);
    setStatus(result.status);
    if (!result.ok && result.offline) {
      setError("Could not verify subscription status");
    }
  };

  useEffect(() => {
    if (!open || !profileId) return;
    void refreshStatus();
  }, [open, profileId, providerId]);

  useEffect(() => {
    if (!deviceSession) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await pollSubscriptionOAuth(providerId, deviceSession.session_id);
        if (!result.ok) throw new Error(result.error);
        if (result.status === "approved") {
          if (!cancelled) {
            setDeviceSession(null);
            setError("");
            await refreshStatus();
          }
          return;
        }
        if (!cancelled) {
          timer = setTimeout(
            poll,
            Math.max(1, Number(result.retry_after || deviceSession.poll_interval || 2)) * 1000
          );
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : String(pollError));
          setDeviceSession(null);
        }
      }
    };
    timer = setTimeout(poll, Math.max(1, Number(deviceSession.poll_interval || 2)) * 1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deviceSession, profileId, providerId]);

  const startLogin = async () => {
    setBusy(true);
    setError("");
    try {
      const nextSession = await startSubscriptionOAuth(providerId, profileId);
      setDeviceSession(nextSession);
      if (providerId !== "openai-codex") {
        window.open(nextSession.verification_url, "_blank", "noopener,noreferrer");
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await logoutSubscriptionProfile(providerId, profileId);
      setDeviceSession(null);
      await refreshStatus();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : String(logoutError));
    } finally {
      setBusy(false);
    }
  };

  const sessionExpiry = status?.agent_key_expires_at || status?.access_expires_at;
  const sessionExpiryLabel = sessionExpiry
    ? new Date(sessionExpiry).toLocaleString(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <Field label={labels.field}>
      <div className="flex flex-col gap-2 text-[11px] text-text-secondary">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${status?.logged_in ? "bg-emerald-400" : "bg-text-muted/60"}`}
            />
            <span className="min-w-0 truncate text-text-primary">
              {status?.logged_in ? labels.connected : "Not connected"}
              {status?.logged_in && sessionExpiryLabel ? (
                <span className="text-text-muted"> · until {sessionExpiryLabel}</span>
              ) : null}
            </span>
          </div>
          {status?.logged_in ? (
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="shrink-0 text-[11px] text-text-muted transition-colors hover:text-red-400 disabled:opacity-60"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startLogin()}
              disabled={busy || !!deviceSession}
              className="shrink-0 text-[11px] font-medium text-text-primary transition-colors hover:text-white disabled:opacity-60"
            >
              {busy ? "Starting…" : labels.login}
            </button>
          )}
        </div>
        {deviceSession ? (
          <div
            className="flex flex-col gap-1 rounded-sm p-2"
            style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
          >
            {providerId === "openai-codex" ? (
              <>
                <div className="text-text-muted">
                  Device auth (same flow as <span className="font-mono">codex login --device-auth</span>):
                </div>
                <ol className="list-decimal space-y-1 pl-4 text-text-muted">
                  <li>
                    <a
                      href={deviceSession.verification_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-text-primary"
                    >
                      Open the verification page
                    </a>{" "}
                    and sign in
                  </li>
                  <li>Enter this one-time code on that page</li>
                </ol>
              </>
            ) : (
              <div className="text-text-muted">Enter this code in the browser tab:</div>
            )}
            <div className="flex items-center gap-2">
              <div className="font-mono text-sm font-semibold text-text-primary">{deviceSession.user_code}</div>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(deviceSession.user_code)}
                className="text-[10px] text-text-muted underline underline-offset-2 hover:text-text-primary"
              >
                Copy
              </button>
            </div>
            {providerId !== "openai-codex" ? (
              <a
                href={deviceSession.verification_url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] underline underline-offset-2 hover:text-text-primary"
              >
                Open verification page
              </a>
            ) : null}
            {providerId === "openai-codex" ? (
              <div className="text-[10px] text-text-muted">
                Waiting for approval… If the page shows an error, ensure device code auth is enabled for your
                ChatGPT workspace, then try again.
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <div className="text-[10px] text-red-400">{error}</div> : null}
      </div>
    </Field>
  );
}
