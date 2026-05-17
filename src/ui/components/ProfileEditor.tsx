import { useEffect, useState, type ReactNode } from "react";
import { X, Eye, EyeOff, Trash2, Pencil } from "lucide-react";
import { useProfileStore } from "../stores/profile-store";
import {
  useActiveProfileRuntime,
  useProfileRuntime,
  useRuntimeStore,
} from "../stores/runtime-store";
import { startAgent, stopAgent } from "@/core/orchestrator";
import { createAgentName, type Profile } from "@/core/profiles";
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
      editedRuntime.runtimeStatus === "booting" ||
      editedRuntime.runtimeStatus === "installing");

  const [name, setName] = useState("");
  const [userName, setUserName] = useState("");
  const [personalityPresetId, setPersonalityPresetId] = useState(DEFAULT_PERSONALITY_PRESET_ID);
  const [personality, setPersonality] = useState("");
  const [provider, setProvider] = useState<Profile["provider"]>(DEFAULT_PROVIDER_ID);
  const [model, setModel] = useState("");
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [channelTokens, setChannelTokens] = useState<Record<string, string>>({});
  const [channelTokenVisible, setChannelTokenVisible] = useState<Record<string, boolean>>({});
  const [personalityExpanded, setPersonalityExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>("profile");

  useEffect(() => {
    if (!open) return;
    setPersonalityExpanded(false);
    setActiveTab("profile");
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
        const providerDefaultModel =
          LLM_PROVIDERS.find((p) => p.id === loadedProvider)?.model?.trim() ?? "";
        const storedModel = (editing.model || "").trim();
        setModel(storedModel && storedModel !== providerDefaultModel ? storedModel : "");
        setAccentColor(editing.accentColor);
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
        setAccentColor(randomAccentColor());
        setApiKey("");
        setCustomBaseUrl("");
        setChannelTokens({});
      }
    })();
  }, [open, editing, profiles]);

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

  const save = async () => {
    let profileId: string;
    if (editing) {
      profileId = editing.id;
      await updateProfile(editing.id, {
        name,
        userName,
        personality,
        provider,
        model: model.trim(),
        accentColor,
      });
    } else {
      const keepActiveProfile =
        runtimeStatus === "running" ||
        runtimeStatus === "booting" ||
        runtimeStatus === "installing" ||
        runningProfileIds.length > 0;
      const created = await createProfile({
        name,
        userName,
        personality,
        provider,
        model: model.trim(),
        accentColor,
      }, { setActive: !keepActiveProfile });
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

  return (
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

              <div className="grid grid-cols-2 gap-2">
                <Field label="Provider">
                  <SearchableSelect
                    value={provider}
                    options={PROVIDER_OPTIONS}
                    searchPlaceholder="Search provider..."
                    className="w-full"
                    onChange={(nextProvider) => setProvider(nextProvider as Profile["provider"])}
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
                  </>
                );
              })()}

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
                <Field key={channel.id} label={channel.name}>
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
}
