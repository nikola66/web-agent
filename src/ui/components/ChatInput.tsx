import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { submitUserInput } from "@/core/orchestrator";
import { ALLOWED_UPLOAD_EXTENSIONS } from "@embed-runtime/tools/upload-allowlist.js";
import { SLASH_COMMANDS } from "@/agent/embed-commands";
import { writeWorkspaceUpload } from "@/core/workspace";
import { profileAgentWorking, useActiveProfileRuntime } from "../stores/runtime-store";
import { useProfileStore } from "../stores/profile-store";
import { Plus } from "lucide-react";
import { StatusBar } from "./StatusBar";

/** True when the trimmed line is a known slash command (primary token + optional args). */
function shouldSubmitTypedSlashDirectly(value: string): boolean {
  const trimmed = value.trim();
  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  if (!firstToken.startsWith("/")) return false;
  const known = SLASH_COMMANDS.some(
    (c) => c.name === firstToken || c.name.startsWith(`${firstToken} `)
  );
  if (!known) return false;
  return trimmed === firstToken || trimmed.startsWith(`${firstToken} `);
}

function getSlashQuery(value: string): string | null {
  const current = value.trimStart();
  if (!current.startsWith("/")) return null;
  const token = current.split(/\s+/)[0] ?? "";
  if (!token.startsWith("/")) return null;
  return token.slice(1);
}

const CHAT_INPUT_HISTORY_PREFIX = "webagent.chatInputHistory.";
const UPLOAD_ACCEPT = [...ALLOWED_UPLOAD_EXTENSIONS].map((ext) => `.${ext}`).join(",");

function loadPersistedInputHistory(profileId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${CHAT_INPUT_HISTORY_PREFIX}${profileId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function persistInputHistory(profileId: string, lines: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${CHAT_INPUT_HISTORY_PREFIX}${profileId}`, JSON.stringify(lines));
  } catch {
    /* quota / private mode */
  }
}

export function ChatInput() {
  const [value, setValue] = useState("");
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const rt = useActiveProfileRuntime();
  const {
    runtimeStatus,
    onboardingActive,
    awaitingResponse,
    queuedInputs,
    modelId,
  } = rt;
  const agentWorking = profileAgentWorking(rt);
  const queuedCount = queuedInputs.length;
  const workingLabel =
    !awaitingResponse && queuedCount > 0
      ? `${queuedCount} queued — sending soon`
      : queuedCount > 0
        ? `Thinking · ${queuedCount} queued`
        : "Thinking...";
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputHistoryRef = useRef<string[]>([]);
  const historyBrowseIndexRef = useRef<number | null>(null);
  const historyStashRef = useRef("");
  const previousRuntimeStatusRef = useRef(runtimeStatus);
  const dragDepthRef = useRef(0);
  const { activeProfileId } = useProfileStore();
  const disabled = runtimeStatus !== "running" && runtimeStatus !== "booting";
  const slashQuery = getSlashQuery(value);

  const commandMatches = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.trim().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (command) =>
        command.name.slice(1).toLowerCase().includes(q) ||
        command.description.toLowerCase().includes(q)
    );
  }, [slashQuery]);

  useLayoutEffect(() => {
    setSelectedCommand(0);
  }, [slashQuery]);

  useEffect(() => {
    const previousStatus = previousRuntimeStatusRef.current;
    const bootJustFinished =
      runtimeStatus === "running" &&
      (previousStatus === "booting" || previousStatus === "installing");

    if (bootJustFinished) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }

    previousRuntimeStatusRef.current = runtimeStatus;
  }, [runtimeStatus]);

  useEffect(() => {
    historyBrowseIndexRef.current = null;
    if (!activeProfileId) {
      inputHistoryRef.current = [];
      return;
    }
    inputHistoryRef.current = loadPersistedInputHistory(activeProfileId);
  }, [activeProfileId]);

  const replaceTypedSlashWith = (nextCommand: string) => {
    const trimmed = value.trimStart();
    const leadingWhitespaceLength = value.length - trimmed.length;
    const firstToken = trimmed.split(/\s+/)[0] ?? "";
    if (!firstToken.startsWith("/")) return;
    setValue(
      `${value.slice(0, leadingWhitespaceLength)}${nextCommand} ${trimmed.slice(firstToken.length).trimStart()}`
    );
  };

  const dismissSlashMenu = () => {
    const trimmed = value.trimStart();
    const leadingWhitespaceLength = value.length - trimmed.length;
    const firstToken = trimmed.split(/\s+/)[0] ?? "";
    if (!firstToken.startsWith("/")) return;
    const rest = trimmed.slice(firstToken.length).trimStart();
    setValue(`${value.slice(0, leadingWhitespaceLength)}${rest}`);
  };

  const recordSubmittedLine = (line: string, profileId: string | null) => {
    if (!line.trim()) return;
    const h = inputHistoryRef.current;
    if (h[h.length - 1] === line) return;
    h.push(line);
    if (h.length > 200) h.splice(0, h.length - 200);
    if (profileId) persistInputHistory(profileId, h);
  };

  const onSubmit = async () => {
    const line = value;
    const pid = activeProfileId;
    await submitUserInput(line);
    recordSubmittedLine(line, pid);
    historyBrowseIndexRef.current = null;
    setValue("");
  };

  const submitPickedSlashCommand = async () => {
    if (slashQuery === null || commandMatches.length === 0) return false;
    const idx = Math.min(Math.max(0, selectedCommand), commandMatches.length - 1);
    const picked = commandMatches[idx];
    if (!picked) return false;
    const pid = activeProfileId;
    await submitUserInput(picked.name);
    recordSubmittedLine(picked.name, pid);
    historyBrowseIndexRef.current = null;
    setValue("");
    return true;
  };

  const showUploadUnavailable = () => {
    setUploadError("Uploads require a running agent.");
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (runtimeStatus !== "running" || !activeProfileId) {
      showUploadUnavailable();
      return;
    }
    setUploadError(null);
    const uploaded: string[] = [];
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        uploaded.push(await writeWorkspaceUpload(activeProfileId, `uploads/${file.name}`, bytes));
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (uploaded.length > 0) {
      await submitUserInput(`User uploaded files: ${uploaded.join(", ")}`);
    }
    if (failures.length > 0) {
      const message = failures[0] || "Upload failed.";
      console.error("Upload failed:", message);
      setUploadError(message);
    }
  };

  return (
    <div
      className="box-border w-full min-w-[800px] shrink-0 px-4 py-3"
      data-testid="chat-input-root"
      data-agent-onboarding={onboardingActive ? "true" : "false"}
      data-agent-awaiting={awaitingResponse ? "true" : "false"}
      data-agent-working={agentWorking ? "true" : "false"}
      data-agent-queued-count={queuedInputs.length}
      data-agent-runtime-status={runtimeStatus}
      data-agent-model={modelId ?? ""}
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragActive(false);
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        void handleUploadFiles(e.dataTransfer.files);
      }}
      style={{
        background: "rgba(17, 17, 17, 1)",
        boxShadow: dragActive ? "inset 0 0 0 1px rgba(251,117,252,0.45)" : undefined,
      }}
    >
      {agentWorking ? (
        <div
          className="-mt-1 mb-0.5 flex min-h-5 items-center gap-2 px-0.5"
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
          <span className="text-[11px] font-medium tracking-wide text-brand-magenta-light/95">
            {workingLabel}
          </span>
          {modelId ? (
            <span className="min-w-0 truncate text-[10px] tracking-wide text-text-muted" title={modelId}>
              {modelId}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="relative flex w-full items-center gap-2 py-2 font-mono">
        <button
          type="button"
          aria-label="Upload files"
          data-testid="chat-input-upload"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-text-muted transition-colors hover:text-text-primary"
          onClick={() => {
            if (runtimeStatus !== "running" || !activeProfileId) {
              showUploadUnavailable();
              return;
            }
            setUploadError(null);
            fileInputRef.current?.click();
          }}
        >
          <Plus size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) void handleUploadFiles(files);
            e.target.value = "";
          }}
        />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            historyBrowseIndexRef.current = null;
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (slashQuery !== null && commandMatches.length > 0) {
              if (e.key === "Escape") {
                e.preventDefault();
                dismissSlashMenu();
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedCommand((idx) => (idx + 1) % commandMatches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedCommand(
                  (idx) => (idx - 1 + commandMatches.length) % commandMatches.length
                );
                return;
              }
              if (e.key === "Tab") {
                e.preventDefault();
                const picked = commandMatches[selectedCommand];
                if (picked) replaceTypedSlashWith(picked.name);
                return;
              }
            }

            if (
              !disabled &&
              (e.key === "ArrowUp" || e.key === "ArrowDown") &&
              inputHistoryRef.current.length > 0
            ) {
              const hist = inputHistoryRef.current;
              if (e.key === "ArrowUp") {
                e.preventDefault();
                if (historyBrowseIndexRef.current === null) {
                  historyStashRef.current = value;
                  historyBrowseIndexRef.current = hist.length - 1;
                } else if (historyBrowseIndexRef.current > 0) {
                  historyBrowseIndexRef.current--;
                }
                setValue(hist[historyBrowseIndexRef.current]);
                return;
              }
              if (historyBrowseIndexRef.current !== null) {
                e.preventDefault();
                if (historyBrowseIndexRef.current < hist.length - 1) {
                  historyBrowseIndexRef.current++;
                  setValue(hist[historyBrowseIndexRef.current]);
                } else {
                  historyBrowseIndexRef.current = null;
                  setValue(historyStashRef.current);
                }
                return;
              }
            }

            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (shouldSubmitTypedSlashDirectly(value)) {
                void onSubmit();
                return;
              }
              if (slashQuery !== null && commandMatches.length > 0) {
                void submitPickedSlashCommand();
                return;
              }
              void onSubmit();
            }
          }}
          disabled={disabled}
          className="h-7 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
          placeholder={
            runtimeStatus === "running"
              ? "Type message (Enter to send, /stop to interrupt)"
              : "Launch the agent to start chatting"
          }
        />
        {slashQuery !== null && commandMatches.length > 0 && (
          <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full border border-[#fb75fc4d] bg-[#05050dd9] p-2 shadow-[0_0_0_1px_rgba(251,117,252,0.16),0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-sm">
            <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.22em] text-brand-magenta-light">
              slash commands
            </p>
            <div className="border-t border-white/10 pt-1">
              {commandMatches.map((command, index) => {
                const active = index === selectedCommand;
                return (
                  <div
                    key={command.name}
                    className="px-2 py-1.5"
                    style={{
                      background: active
                        ? "linear-gradient(90deg, rgba(251,117,252,0.24), rgba(138,56,245,0.14) 70%, rgba(138,56,245,0.04))"
                        : "transparent",
                      boxShadow: active
                        ? "inset 0 0 0 1px rgba(251,117,252,0.34)"
                        : "none",
                    }}
                  >
                    <p className="text-xs font-semibold tracking-[0.08em] text-[#f8e7ff]">
                      {command.name}
                    </p>
                    <p className="text-[11px] leading-4 tracking-[0.02em] text-[#bda6d3]">
                      {command.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {uploadError ? <p className="mt-1 text-[11px] text-red-300">{uploadError}</p> : null}
      <div className="mt-1 w-full">
        <StatusBar />
      </div>
    </div>
  );
}
