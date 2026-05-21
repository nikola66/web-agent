import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { submitUserInput } from "@/core/orchestrator";
import { ALLOWED_UPLOAD_EXTENSIONS } from "@embed-runtime/tools/upload-allowlist.js";
import { SLASH_COMMANDS } from "@/agent/embed-commands";
import { writeWorkspaceUpload } from "@/core/workspace";
import { transcribeBlob } from "@/core/voice/stt-client";
import { profileAgentWorking, useActiveProfileRuntime } from "../stores/runtime-store";
import { useProfileStore } from "../stores/profile-store";
import { Mic, MicOff, Plus } from "lucide-react";
import { StatusBar } from "./StatusBar";
import { useVoiceStore } from "../stores/voice-store";

// ---------------------------------------------------------------------------
// Browser mic recording (MediaRecorder → local Whisper STT)
// ---------------------------------------------------------------------------
type RecState = "idle" | "recording";

const VOICE_CHUNK_MS = 2500;

function pickRecordingMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "audio/webm", ext: "webm" };
}

function useVoiceRecording({
  onError,
  onInterim,
}: {
  onError: (msg: string) => void;
  onInterim: (chunk: string) => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const formatRef = useRef(pickRecordingMime());
  const transcribeQueueRef = useRef(Promise.resolve());
  const [recState, setRecState] = useState<RecState>("idle");

  const isSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const enqueueChunkTranscribe = useCallback(
    (blob: Blob) => {
      transcribeQueueRef.current = transcribeQueueRef.current
        .then(async () => {
          const text = await transcribeBlob(blob);
          if (text) onInterim(text);
        })
        .catch(() => {
          /* chunk failures are non-fatal */
        });
    },
    [onInterim]
  );

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const format = pickRecordingMime();
      formatRef.current = format;
      const recorder = new MediaRecorder(
        stream,
        format.mime ? { mimeType: format.mime } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          enqueueChunkTranscribe(e.data);
        }
      };
      recorder.onerror = () => {
        onError("Recording failed. Try again.");
        releaseStream();
        recorderRef.current = null;
        setRecState("idle");
      };
      recorder.start(VOICE_CHUNK_MS);
      recorderRef.current = recorder;
      setRecState("recording");
    } catch (err) {
      onError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission denied. Allow mic access in your browser settings."
          : "Could not access the microphone."
      );
    }
  }, [enqueueChunkTranscribe, onError, releaseStream]);

  const stop = useCallback((): Promise<{ blob: Blob; ext: string } | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        releaseStream();
        recorderRef.current = null;
        setRecState("idle");
        const ext = formatRef.current.ext;
        const blob = new Blob(chunksRef.current, {
          type: formatRef.current.mime || "audio/webm",
        });
        chunksRef.current = [];
        void transcribeQueueRef.current.finally(() => {
          resolve(blob.size > 0 ? { blob, ext } : null);
        });
      };
      recorder.stop();
    });
  }, [releaseStream]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      releaseStream();
      recorderRef.current = null;
    };
  }, [releaseStream]);

  return { recState, isSupported, start, stop };
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ChatInput() {
  const [value, setValue] = useState("");
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSending, setVoiceSending] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  const voiceEnabled = useVoiceStore((s) => s.enabled);
  const rt = useActiveProfileRuntime();
  const {
    runtimeStatus,
    onboardingActive,
    awaitingResponse,
    queuedInputs,
    modelId,
  } = rt;
  const agentWorking = profileAgentWorking(rt);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputHistoryRef = useRef<string[]>([]);
  const historyBrowseIndexRef = useRef<number | null>(null);
  const historyStashRef = useRef("");
  const previousRuntimeStatusRef = useRef(runtimeStatus);
  const dragDepthRef = useRef(0);
  const { activeProfileId } = useProfileStore();
  const disabled = runtimeStatus !== "running" && runtimeStatus !== "booting";

  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
  }, []);

  const appendInterim = useCallback((chunk: string) => {
    setInterimTranscript((prev) => (prev ? `${prev} ${chunk}` : chunk));
  }, []);

  const { recState, isSupported: micSupported, start: startRecording, stop: stopRecording } =
    useVoiceRecording({ onError: handleVoiceError, onInterim: appendInterim });

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

  const AUTOSIZE_MAX_ROWS = 4;
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      const fontSize = parseFloat(cs.fontSize) || 14;
      lineHeight = fontSize * 1.25;
    }
    const maxH = lineHeight * AUTOSIZE_MAX_ROWS;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, maxH);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  }, [value]);

  useEffect(() => {
    const previousStatus = previousRuntimeStatusRef.current;
    const bootJustFinished =
      runtimeStatus === "running" &&
      (previousStatus === "booting" || previousStatus === "installing");
    if (bootJustFinished) {
      requestAnimationFrame(() => inputRef.current?.focus());
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
    const line = value.trim();
    if (!line) return;
    const pid = activeProfileId;
    await submitUserInput(line);
    recordSubmittedLine(line, pid);
    historyBrowseIndexRef.current = null;
    setValue("");
  };

  const onMicClick = async () => {
    if (!activeProfileId || disabled) return;
    setVoiceError(null);
    if (recState === "recording") {
      setVoiceSending(true);
      try {
        const recorded = await stopRecording();
        if (!recorded) {
          setVoiceError("No audio captured. Try again.");
          setInterimTranscript("");
          return;
        }
        const { blob } = recorded;
        const finalText = (await transcribeBlob(blob)).trim() || interimTranscript.trim();
        setInterimTranscript("");
        if (!finalText) {
          setVoiceError("Could not transcribe audio. Try again.");
          return;
        }
        await submitUserInput(finalText);
        recordSubmittedLine(finalText, activeProfileId);
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : "Failed to send voice message.");
      } finally {
        setVoiceSending(false);
      }
      return;
    }
    setInterimTranscript("");
    await startRecording();
  };

  const submitSlashPick = async (picked: { name: string }) => {
    const pid = activeProfileId;
    await submitUserInput(picked.name);
    recordSubmittedLine(picked.name, pid);
    historyBrowseIndexRef.current = null;
    setValue("");
  };

  const submitPickedSlashCommand = async () => {
    if (slashQuery === null || commandMatches.length === 0) return false;
    const idx = Math.min(Math.max(0, selectedCommand), commandMatches.length - 1);
    const picked = commandMatches[idx];
    if (!picked) return false;
    await submitSlashPick(picked);
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
      className="box-border w-full min-w-0 shrink-0 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] md:min-w-[800px]"
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
      <div className="relative flex w-full items-center gap-2 py-2 font-mono">
        <button
          type="button"
          aria-label="Upload files"
          data-testid="chat-input-upload"
          disabled={disabled}
          title={disabled ? "Start agent first..." : undefined}
          className={[
            "inline-flex min-h-8 min-w-8 shrink-0 touch-manipulation items-center justify-center rounded-[3px] bg-white/5 text-text-muted transition-colors",
            disabled ? "pointer-events-none opacity-20" : "hover:text-text-primary",
          ].join(" ")}
          onClick={() => {
            if (disabled || !activeProfileId) return;
            setUploadError(null);
            fileInputRef.current?.click();
          }}
        >
          <Plus size={12} />
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

        {/* Mic button — only shown when voice mode is enabled */}
        {(voiceEnabled || recState !== "idle") && micSupported && (
          <button
            type="button"
            aria-label={recState === "recording" ? "Stop recording and send" : "Record voice message"}
            data-testid="chat-input-mic"
            disabled={disabled || voiceSending}
            title={disabled ? "Start agent first..." : undefined}
            onClick={() => void onMicClick()}
            className={[
              "inline-flex min-h-8 min-w-8 shrink-0 touch-manipulation items-center justify-center rounded-[3px] transition-colors",
              disabled
                ? "pointer-events-none opacity-20 bg-white/5 text-text-muted"
                : recState === "recording"
                  ? "bg-brand-magenta-light/30 text-brand-magenta-light animate-pulse"
                  : "bg-white/5 text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {recState === "recording" ? <MicOff size={12} /> : <Mic size={12} />}
          </button>
        )}

        <textarea
          ref={inputRef}
          rows={1}
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
              inputHistoryRef.current.length > 0 &&
              recState === "idle"
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
          disabled={disabled || recState === "recording" || voiceSending}
          className="min-h-10 resize-none overflow-y-hidden flex-1 bg-transparent py-2 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60 md:min-h-7 md:py-1.5"
          placeholder={
            runtimeStatus === "running"
              ? recState === "recording"
                ? "Recording… click mic to stop and send"
                : voiceSending
                  ? "Sending voice message…"
                  : "Type message (Enter to send, /stop to interrupt)"
              : "Launch the agent to start chatting"
          }
        />

        {slashQuery !== null && commandMatches.length > 0 && (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full border border-[#fb75fc4d] bg-[#05050dd9] p-2 shadow-[0_0_0_1px_rgba(251,117,252,0.16),0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-sm">
            <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.22em] text-brand-magenta-light">
              slash commands
            </p>
            <div className="border-t border-white/10 pt-1">
              {commandMatches.map((command, index) => {
                const active = index === selectedCommand;
                return (
                  <div
                    key={command.name}
                    className="cursor-pointer px-2 py-1.5"
                    onMouseEnter={() => setSelectedCommand(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void submitSlashPick(command);
                    }}
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

      {/* Status row */}
      {uploadError ? <p className="mt-1 text-[11px] text-red-300">{uploadError}</p> : null}
      {voiceError ? (
        <p className="mt-1 text-[11px] text-red-300">
          <button
            type="button"
            className="mr-2 underline-offset-2 hover:underline"
            onClick={() => setVoiceError(null)}
            aria-label="Dismiss voice error"
          >
            ✕
          </button>
          {voiceError}
        </p>
      ) : null}
      {recState === "recording" && (
        <p className="mt-1 text-[11px] text-brand-magenta-light animate-pulse">
          ● Recording… speak now. Click the mic to stop and send.
          {interimTranscript ? (
            <span className="block mt-0.5 text-foreground/80 animate-none normal-case">
              {interimTranscript}
            </span>
          ) : null}
        </p>
      )}

      <div className="mt-1 w-full">
        <StatusBar />
      </div>
    </div>
  );
}
