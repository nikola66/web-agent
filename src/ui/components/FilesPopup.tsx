import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import {
  Bug,
  Brain,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File,
  FileText,
  Folder,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  downloadWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFileText,
  startWorkspaceTerminalSession,
  WORKSPACE_EMPTY_DIR_INJECTION,
  WORKSPACE_KNOWLEDGE_VAULT_DIR_REL,
  WORKSPACE_PLANS_DIR_REL,
  type WorkspaceTerminalSession,
  type WorkspaceFileEntry,
} from "@/core/workspace";
import { SearchableSelect } from "./SearchableSelect";
import { MemoryTab } from "./MemoryTab";
import { terminalTheme } from "../theme";
import { formatBytes } from "../utils/format";

const DEBUG_LOG_VIEWER_ENABLED =
  String(import.meta.env.VITE_WEBAGENT_DEBUG_LOG || "").trim() === "1";

const PREVIEW_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "html",
  "yml",
  "yaml",
  "log",
  "env",
]);

function canPreview(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return PREVIEW_EXTENSIONS.has(ext);
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

type DebugLogEvent = {
  ts?: string;
  event?: string;
  source?: string;
  payload?: Record<string, unknown>;
};

function parseJsonl(content: string): DebugLogEvent[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed: DebugLogEvent[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as DebugLogEvent;
      if (entry && typeof entry === "object") parsed.push(entry);
    } catch {
      // best effort: ignore malformed lines
    }
  }
  return parsed;
}

function isLikelyDebugError(entry: DebugLogEvent): boolean {
  const marker = `${entry.event || ""} ${entry.source || ""}`.toLowerCase();
  if (/error|fail|timeout/.test(marker)) return true;
  const payload = entry.payload;
  if (!payload || typeof payload !== "object") return false;
  return Object.keys(payload).some((key) => /error|fail|timeout/.test(key.toLowerCase()));
}

function formatEventTime(ts?: string): string {
  if (!ts) return "--:--:--.---";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString([], { hour12: false, fractionalSecondDigits: 3 });
}

function eventSummary(entry: DebugLogEvent): string {
  const payload = entry.payload || {};
  const picks = ["tool", "status", "error", "durationMs", "bytes", "hits"]
    .filter((key) => payload[key] !== undefined)
    .map((key) => `${key}=${String(payload[key])}`);
  return picks.join(" · ");
}

type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTreeNode[];
};

function buildFileTree(
  entries: WorkspaceFileEntry[],
  basePrefix: string
): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  const upsertChild = (
    nodes: FileTreeNode[],
    name: string,
    fullPath: string,
    isDirectory: boolean
  ): FileTreeNode => {
    const existing = nodes.find((node) => node.name === name && node.isDirectory === isDirectory);
    if (existing) return existing;
    const created: FileTreeNode = {
      id: fullPath,
      name,
      path: fullPath,
      isDirectory,
      children: [],
    };
    nodes.push(created);
    return created;
  };

  for (const entry of sorted) {
    const relative = basePrefix && entry.path.startsWith(`${basePrefix}/`)
      ? entry.path.slice(basePrefix.length + 1)
      : entry.path;
    if (!relative) continue;
    const segments = relative.split("/").filter(Boolean);
    let level = roots;
    let builtRelative = "";

    segments.forEach((segment, index) => {
      builtRelative = builtRelative ? `${builtRelative}/${segment}` : segment;
      const fullPath = basePrefix ? `${basePrefix}/${builtRelative}` : builtRelative;
      const isDirectory = index < segments.length - 1;
      const node = upsertChild(level, segment, fullPath, isDirectory);
      if (isDirectory) level = node.children;
    });
  }

  const normalize = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .map((node) => ({
        ...node,
        children: normalize(
          [...node.children].sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
        ),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

  return normalize(roots);
}

function injectEmptyWorkspaceDirs(
  roots: FileTreeNode[],
  emptyDirPaths: string[]
): FileTreeNode[] {
  if (emptyDirPaths.length === 0) return roots;
  const next = [...roots];
  for (const dirPath of emptyDirPaths) {
    const segments = dirPath.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let level = next;
    let accumulated = "";
    for (const seg of segments) {
      accumulated = accumulated ? `${accumulated}/${seg}` : seg;
      let node = level.find((n) => n.name === seg);
      if (!node) {
        node = {
          id: accumulated,
          name: seg,
          path: accumulated,
          isDirectory: true,
          children: [],
        };
        level.push(node);
      } else if (!node.isDirectory) {
        break;
      }
      level = node.children;
    }
  }

  const normalize = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .map((node) => ({
        ...node,
        children: node.isDirectory ? normalize(node.children) : [],
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  return normalize(next);
}

export function FilesPopup({
  profileId,
  onClose,
}: {
  profileId: string;
  onClose: () => void;
}) {
  const hasDebugTab = DEBUG_LOG_VIEWER_ENABLED;
  const [activeTab, setActiveTab] = useState<"files" | "debug" | "terminal" | "memory">("files");
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedDebugLogPath, setSelectedDebugLogPath] = useState<string | null>(null);
  const [debugLogContent, setDebugLogContent] = useState<string>("");
  const [debugLogLoading, setDebugLogLoading] = useState(false);
  const [debugLogError, setDebugLogError] = useState<string | null>(null);
  const [showChunkEvents, setShowChunkEvents] = useState(false);
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [selectedDebugEventIndex, setSelectedDebugEventIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalSessionRef = useRef<WorkspaceTerminalSession | null>(null);

  const webagentRoot = ".webagent";
  const memoryRoot = "memory";
  const fileTree = useMemo(
    () =>
      injectEmptyWorkspaceDirs(buildFileTree(files, ""), [...WORKSPACE_EMPTY_DIR_INJECTION]),
    [files]
  );
  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath]
  );
  const debugLogFiles = useMemo(
    () =>
      files
        .filter(
          (file) => file.path.startsWith("debug-logs/") && file.path.toLowerCase().endsWith(".jsonl")
        )
        .sort((a, b) => b.path.localeCompare(a.path)),
    [files]
  );
  const parsedDebugEvents = useMemo(() => parseJsonl(debugLogContent), [debugLogContent]);
  const filteredDebugEvents = useMemo(() => {
    return parsedDebugEvents.filter((entry) => {
      if (!showChunkEvents && entry.event === "rendered_output_chunk") return false;
      if (showOnlyIssues && !isLikelyDebugError(entry)) return false;
      return true;
    });
  }, [parsedDebugEvents, showChunkEvents, showOnlyIssues]);
  const allIssueEvents = useMemo(
    () => parsedDebugEvents.filter((entry) => isLikelyDebugError(entry)),
    [parsedDebugEvents]
  );
  const filteredIssueEvents = useMemo(
    () => filteredDebugEvents.filter((entry) => isLikelyDebugError(entry)),
    [filteredDebugEvents]
  );
  const debugErrorCount = filteredIssueEvents.length;
  const recentDebugEvents = useMemo(() => filteredDebugEvents.slice(-80).reverse(), [filteredDebugEvents]);
  const selectedDebugEvent = recentDebugEvents[selectedDebugEventIndex] ?? null;

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const nextFiles = await listWorkspaceFiles(profileId, { preferLive: true });
      setFiles(nextFiles);
      setSelectedPath((current) => {
        if (current && nextFiles.some((file) => file.path === current)) {
          return current;
        }
        const preferred = nextFiles.find(
          (file) => file.path.startsWith(".webagent/") || file.path === ".webagent"
        );
        return preferred?.path ?? nextFiles[0]?.path ?? null;
      });
      if (DEBUG_LOG_VIEWER_ENABLED) {
        const nextDebugLogs = nextFiles
          .filter(
            (file) => file.path.startsWith("debug-logs/") && file.path.toLowerCase().endsWith(".jsonl")
          )
          .sort((a, b) => b.path.localeCompare(a.path));
        setSelectedDebugLogPath((current) => {
          if (current && nextDebugLogs.some((file) => file.path === current)) return current;
          return nextDebugLogs[0]?.path ?? null;
        });
      }
    } catch (err) {
      console.error("Failed to load workspace files:", err);
      setError("Failed to load files.");
      setFiles([]);
      setSelectedPath(null);
      setPreviewOpen(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFiles();
  }, [profileId]);

  useEffect(() => {
    if (!selectedPath || !canPreview(selectedPath)) {
      setPreviewContent("");
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    const loadPreview = async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const content = await readWorkspaceFileText(profileId, selectedPath, { preferLive: true });
        if (!cancelled) {
          setPreviewContent(content);
        }
      } catch (err) {
        console.error("Failed to load file preview:", err);
        if (!cancelled) {
          setPreviewContent("");
          setPreviewError("Could not preview this file.");
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [profileId, selectedPath]);

  useEffect(() => {
    const next = new Set<string>();
    if (files.length === 0) {
      setExpandedFolders(next);
      return;
    }
    next.add(webagentRoot);
    next.add(WORKSPACE_PLANS_DIR_REL);
    next.add(WORKSPACE_KNOWLEDGE_VAULT_DIR_REL);
    next.add(`${webagentRoot}/tools`);
    next.add(`${webagentRoot}/channels`);
    next.add(`${webagentRoot}/state`);
    next.add(memoryRoot);
    next.add(`${memoryRoot}/snapshots`);
    setExpandedFolders(next);
  }, [files, webagentRoot, memoryRoot]);

  useEffect(() => {
    if (!DEBUG_LOG_VIEWER_ENABLED || !selectedDebugLogPath) {
      setDebugLogContent("");
      setDebugLogError(null);
      setSelectedDebugEventIndex(0);
      return;
    }

    let cancelled = false;
    const loadDebugLog = async () => {
      setDebugLogLoading(true);
      setDebugLogError(null);
      try {
        const content = await readWorkspaceFileText(profileId, selectedDebugLogPath, {
          preferLive: true,
        });
        if (!cancelled) {
          setDebugLogContent(content);
          setSelectedDebugEventIndex(0);
        }
      } catch (err) {
        console.error("Failed to load debug log:", err);
        if (!cancelled) {
          setDebugLogContent("");
          setDebugLogError("Could not read selected debug log.");
        }
      } finally {
        if (!cancelled) {
          setDebugLogLoading(false);
        }
      }
    };

    void loadDebugLog();
    return () => {
      cancelled = true;
    };
  }, [profileId, selectedDebugLogPath]);

  const handleDownload = async () => {
    if (!selectedPath) return;
    try {
      await downloadWorkspaceFile(profileId, selectedPath, { preferLive: true });
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  const fitAndResizeTerminal = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    const session = terminalSessionRef.current;
    if (!fitAddon || !terminal) return;
    fitAddon.fit();
    if (session) {
      session.resize(terminal.cols, terminal.rows);
    }
  }, []);

  const stopTerminalSession = useCallback(() => {
    terminalSessionRef.current?.kill();
    terminalSessionRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    setTerminalReady(false);
  }, []);

  const startTerminalSession = useCallback(async () => {
    if (terminalSessionRef.current || !terminalContainerRef.current) return;
    setTerminalError(null);

    const terminal = new XTerm({
      theme: terminalTheme,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 12,
      lineHeight: 1.25,
      letterSpacing: 0.1,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      scrollback: 5000,
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.writeln("\x1b[90mStarting workspace shell...\x1b[0m");

    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "c" &&
        !terminal.getSelection()
      ) {
        void terminalSessionRef.current?.write("\u0003");
        return false;
      }
      return true;
    });
    terminal.onData((data) => {
      void terminalSessionRef.current?.write(data);
    });

    try {
      const session = await startWorkspaceTerminalSession(profileId, {
        cols: terminal.cols,
        rows: terminal.rows,
        onOutput: (chunk) => terminal.write(chunk),
        onExit: (exitCode) => {
          terminal.writeln(`\r\n\x1b[90m[shell exited with code ${String(exitCode ?? "?")}]\x1b[0m`);
          terminalSessionRef.current = null;
          setTerminalReady(false);
        },
      });
      terminalSessionRef.current = session;
      setTerminalReady(true);
      terminal.focus();
      fitAndResizeTerminal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start terminal.";
      setTerminalError(message);
      terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
    }
  }, [fitAndResizeTerminal, profileId]);

  useEffect(() => {
    if (activeTab === "terminal") {
      void startTerminalSession();
    }
  }, [activeTab, startTerminalSession]);

  useEffect(() => {
    if (activeTab !== "terminal") return;
    const observer = new ResizeObserver(() => {
      fitAndResizeTerminal();
    });
    if (terminalContainerRef.current) {
      observer.observe(terminalContainerRef.current);
    }
    const onWindowResize = () => fitAndResizeTerminal();
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      observer.disconnect();
    };
  }, [activeTab, fitAndResizeTerminal]);

  useEffect(() => {
    return () => {
      stopTerminalSession();
    };
  }, [stopTerminalSession]);

  useEffect(() => {
    stopTerminalSession();
  }, [profileId, stopTerminalSession]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleFileClick = useCallback((path: string) => {
    setSelectedPath(path);
    if (canPreview(path)) setPreviewOpen(true);
  }, []);

  const handleFileDoubleClick = useCallback((path: string) => {
    setSelectedPath(path);
    setPreviewOpen(true);
  }, []);

  const renderTreeNode = useCallback(
    (node: FileTreeNode, depth: number) => {
      if (node.isDirectory) {
        const open = expandedFolders.has(node.path);
        return (
          <div key={node.id}>
            <button
              type="button"
              onClick={() => toggleFolder(node.path)}
              className="mb-0.5 flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[11px] text-text-secondary hover:bg-white/5"
              style={{ paddingLeft: `${6 + depth * 14}px` }}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={12} className="text-brand-magenta-light" />
              <span className="truncate">{node.name}</span>
            </button>
            {open ? node.children.map((child) => renderTreeNode(child, depth + 1)) : null}
          </div>
        );
      }
      const active = selectedPath === node.path;
      return (
        <button
          key={node.id}
          type="button"
          onClick={() => handleFileClick(node.path)}
          onDoubleClick={() => handleFileDoubleClick(node.path)}
          className="mb-0.5 flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[11px] transition-colors"
          style={{
            paddingLeft: `${6 + depth * 14}px`,
            background: active ? "rgba(251,117,252,0.18)" : "transparent",
            color: active ? "rgb(248,231,255)" : "rgba(255,255,255,0.82)",
          }}
          title={node.path}
        >
          <File size={12} className="text-text-muted" />
          <span className="truncate">{node.name}</span>
        </button>
      );
    },
    [expandedFolders, handleFileClick, handleFileDoubleClick, selectedPath, toggleFolder]
  );

  const [issuesCopyState, setIssuesCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyIssuesDebugBundle = useCallback(async () => {
    const bundle = {
      meta: {
        exportedAt: new Date().toISOString(),
        profileId,
        debugLogPath: selectedDebugLogPath,
        filters: { showChunkEvents, showOnlyIssues },
        parsedEventCount: parsedDebugEvents.length,
        filteredEventCount: filteredDebugEvents.length,
        issuesInCurrentFilterView: filteredIssueEvents.length,
        issuesInEntireLoadedLog: allIssueEvents.length,
      },
      /** Matches the "N possible issues" label (respects chunk / issues-only filters). */
      issuesInCurrentFilterView: filteredIssueEvents,
      /** Every event in the loaded file classified as a possible issue. */
      issuesInEntireLoadedLog: allIssueEvents,
      rawLogCharacterCount: debugLogContent.length,
    };
    const text = JSON.stringify(bundle, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setIssuesCopyState("copied");
      window.setTimeout(() => setIssuesCopyState("idle"), 2000);
    } catch (err) {
      console.error("Copy issues bundle failed:", err);
      setIssuesCopyState("error");
      window.setTimeout(() => setIssuesCopyState("idle"), 2500);
    }
  }, [
    allIssueEvents,
    debugLogContent.length,
    filteredDebugEvents.length,
    filteredIssueEvents,
    parsedDebugEvents.length,
    profileId,
    selectedDebugLogPath,
    showChunkEvents,
    showOnlyIssues,
  ]);

  return (
    <div
      className="absolute right-0 bottom-full z-40 mb-2 max-h-[75vh] w-[min(560px,calc(100vw-16px))] overflow-y-auto border border-[#fb75fc4d] bg-[#05050dd9] shadow-[0_0_0_1px_rgba(251,117,252,0.16),0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-sm"
      role="dialog"
      aria-label="Files"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          {activeTab === "files" ? (
            <FileText size={13} className="text-brand-magenta-light" />
          ) : activeTab === "terminal" ? (
            <TerminalSquare size={13} className="text-brand-magenta-light" />
          ) : activeTab === "memory" ? (
            <Brain size={13} className="text-brand-magenta-light" />
          ) : (
            <Bug size={13} className="text-brand-magenta-light" />
          )}
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#f8e7ff]">WORKSPACE</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (activeTab === "memory") {
                setMemoryRefreshKey((current) => current + 1);
              }
              void loadFiles();
            }}
            className="rounded-sm p-1 text-text-muted transition-colors hover:text-text-primary"
            aria-label="Refresh files"
            title="Refresh files"
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-text-muted transition-colors hover:text-text-primary"
            aria-label="Close files popup"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1">
        <button
          type="button"
          onClick={() => setActiveTab("files")}
          className="rounded-sm px-2 py-1 text-[11px] transition-colors"
          style={{
            background: activeTab === "files" ? "rgba(251,117,252,0.18)" : "transparent",
            color: activeTab === "files" ? "rgb(248,231,255)" : "rgba(255,255,255,0.65)",
          }}
        >
          Files
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("terminal")}
          className="rounded-sm px-2 py-1 text-[11px] transition-colors"
          style={{
            background: activeTab === "terminal" ? "rgba(251,117,252,0.18)" : "transparent",
            color: activeTab === "terminal" ? "rgb(248,231,255)" : "rgba(255,255,255,0.65)",
          }}
        >
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("memory")}
          className="rounded-sm px-2 py-1 text-[11px] transition-colors"
          style={{
            background: activeTab === "memory" ? "rgba(251,117,252,0.18)" : "transparent",
            color: activeTab === "memory" ? "rgb(248,231,255)" : "rgba(255,255,255,0.65)",
          }}
        >
          Memory
        </button>
        {hasDebugTab && (
          <button
            type="button"
            onClick={() => setActiveTab("debug")}
            className="rounded-sm px-2 py-1 text-[11px] transition-colors"
            style={{
              background: activeTab === "debug" ? "rgba(251,117,252,0.18)" : "transparent",
              color: activeTab === "debug" ? "rgb(248,231,255)" : "rgba(255,255,255,0.65)",
            }}
          >
            Debug
          </button>
        )}
      </div>

      {activeTab === "files" && (
        <div className="grid h-[420px] min-h-0 grid-cols-[240px_1fr]">
          <div className="min-h-0 border-r border-white/10">
            {loading ? (
              <p className="px-3 py-2 text-[11px] text-text-muted">Loading files...</p>
            ) : error ? (
              <p className="px-3 py-2 text-[11px] text-red-300">{error}</p>
            ) : files.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-text-muted">No files in workspace.</p>
            ) : (
              <div className="h-full overflow-y-auto p-1.5">
                <div className="mb-2 px-1.5 text-[10px] text-text-muted">Root: /workspace</div>
                {fileTree.map((node) => renderTreeNode(node, 0))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] text-text-secondary">
                  {selectedFile?.path ?? "Select a file"}
                </p>
                <p className="text-[10px] text-text-muted">
                  {selectedFile ? formatBytes(selectedFile.size) : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!selectedFile}
                className="inline-flex items-center gap-1 rounded-sm border border-white/10 px-2 py-1 text-[10px] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={11} />
                Download
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {!selectedFile ? (
                <p className="text-[11px] text-text-muted">Choose a file to view details.</p>
              ) : !previewOpen ? (
                <p className="text-[11px] text-text-muted">
                  Click a preview-supported file or double-click any file to open preview.
                </p>
              ) : !canPreview(selectedFile.path) ? (
                <p className="text-[11px] text-text-muted">
                  Preview not supported for this file type. Use Download to open it locally.
                </p>
              ) : previewLoading ? (
                <p className="text-[11px] text-text-muted">Loading preview...</p>
              ) : previewError ? (
                <p className="text-[11px] text-red-300">{previewError}</p>
              ) : (
                <pre className="whitespace-pre-wrap wrap-break-word text-[11px] leading-relaxed text-text-secondary">
                  {previewContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "terminal" && (
        <div className="flex h-[420px] min-h-0 min-w-0 flex-col p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-[#f8e7ff]">WORKSPACE TERMINAL</p>
            <span className={`text-[10px] ${terminalReady ? "text-emerald-300" : "text-text-muted"}`}>
              {terminalReady ? "connected" : "starting"}
            </span>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void terminalSessionRef.current?.write("\u0003");
              }}
              className="rounded-sm border border-white/10 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ctrl+C
            </button>
            <button
              type="button"
              onClick={() => terminalRef.current?.clear()}
              className="rounded-sm border border-white/10 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                stopTerminalSession();
                if (activeTab === "terminal") {
                  void startTerminalSession();
                }
              }}
              className="rounded-sm border border-white/10 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
            >
              Restart
            </button>
          </div>
          {terminalError ? <p className="mb-2 text-[11px] text-red-300">{terminalError}</p> : null}
          <div ref={terminalContainerRef} className="min-h-0 flex-1 overflow-hidden border border-white/10 bg-black/20" />
        </div>
      )}

      {activeTab === "memory" && (
        <MemoryTab profileId={profileId} refreshKey={memoryRefreshKey} />
      )}

      {activeTab === "debug" && hasDebugTab && (
        <div className="flex h-[420px] min-h-0 min-w-0 flex-col p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-[#f8e7ff]">DEBUG LOG VIEWER</p>
            <span className="text-[10px] text-text-muted">
              {debugLogFiles.length} file{debugLogFiles.length === 1 ? "" : "s"}
            </span>
          </div>
          {debugLogFiles.length === 0 ? (
            <p className="text-[11px] text-text-muted">
              No debug logs found yet. Stop/restart the agent and refresh files.
            </p>
          ) : (
            <>
              <SearchableSelect
                value={selectedDebugLogPath ?? ""}
                options={debugLogFiles.map((file) => ({
                  value: file.path,
                  label: basename(file.path),
                }))}
                onChange={(nextPath) => setSelectedDebugLogPath(nextPath || null)}
                placeholder="Select debug log"
                searchPlaceholder="Search debug logs..."
                className="mb-2 border-white/10 text-[11px] text-text-secondary"
              />
              {debugLogLoading ? (
                <p className="text-[11px] text-text-muted">Loading debug log...</p>
              ) : debugLogError ? (
                <p className="text-[11px] text-red-300">{debugLogError}</p>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                    <span>{filteredDebugEvents.length} shown</span>
                    <span>({parsedDebugEvents.length} total)</span>
                    <span className="inline-flex items-center gap-2">
                      <span className={debugErrorCount > 0 ? "text-red-300" : "text-emerald-300"}>
                        {debugErrorCount} possible issues
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyIssuesDebugBundle()}
                        disabled={parsedDebugEvents.length === 0}
                        className="inline-flex items-center gap-1 rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors hover:border-white/25 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        title="Copy JSON: meta, all issue events in this log, and issues matching current filters"
                        aria-label="Copy all possible issues data for debugging"
                      >
                        <Copy size={10} aria-hidden />
                        {issuesCopyState === "copied"
                          ? "Copied"
                          : issuesCopyState === "error"
                            ? "Copy failed"
                            : "Copy issues"}
                      </button>
                    </span>
                    <span>newest first</span>
                  </div>
                  <div className="mb-2 flex items-center gap-3 text-[11px] text-text-muted">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={showChunkEvents}
                        onChange={(event) => setShowChunkEvents(event.target.checked)}
                      />
                      show chunks
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={showOnlyIssues}
                        onChange={(event) => setShowOnlyIssues(event.target.checked)}
                      />
                      issues only
                    </label>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1 overflow-auto border border-white/10 p-2">
                    {recentDebugEvents.length === 0 ? (
                      <p className="text-[11px] text-text-muted">No parsable events.</p>
                    ) : (
                      recentDebugEvents.map((entry, idx) => (
                        <button
                          type="button"
                          key={`${entry.ts || "no-ts"}-${idx}`}
                          onClick={() => setSelectedDebugEventIndex(idx)}
                          className="block w-full text-left text-[10px] text-text-secondary"
                          style={{
                            background:
                              idx === selectedDebugEventIndex
                                ? "rgba(251,117,252,0.18)"
                                : "transparent",
                          }}
                        >
                          <span className="text-text-muted">{formatEventTime(entry.ts)}</span>{" "}
                          <span className="text-brand-magenta-light">
                            [{String(entry.source || "runtime")}]
                          </span>{" "}
                          {String(entry.event || "event")}
                          {eventSummary(entry) ? (
                            <span className="text-text-muted"> — {eventSummary(entry)}</span>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="mt-2 border border-white/10 p-2">
                    <p className="mb-1 text-[10px] text-text-muted">Selected event payload</p>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap wrap-break-word text-[10px] text-text-secondary">
                      {selectedDebugEvent
                        ? JSON.stringify(selectedDebugEvent, null, 2)
                        : "Select an event to inspect details."}
                    </pre>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
