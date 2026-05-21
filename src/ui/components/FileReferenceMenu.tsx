import { File, FileText, Film, Image, Music, Presentation } from "lucide-react";
import type { ArtifactKind } from "@/core/artifact-preview";
import type { WorkspaceFileIndexEntry } from "@/core/workspace-file-index";
import { formatBytes } from "../utils/format";

function kindIcon(kind: ArtifactKind) {
  switch (kind) {
    case "image":
      return Image;
    case "pdf":
    case "docx":
      return FileText;
    case "pptx":
      return Presentation;
    case "audio":
      return Music;
    case "video":
      return Film;
    default:
      return File;
  }
}

export function FileReferenceMenu(props: {
  matches: WorkspaceFileIndexEntry[];
  selectedIndex: number;
  loading: boolean;
  query: string;
  onPick: (entry: WorkspaceFileIndexEntry) => void;
  onHover: (index: number) => void;
}) {
  const { matches, selectedIndex, loading, query, onPick, onHover } = props;

  return (
    <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full border border-[#fb75fc4d] bg-[#05050dd9] p-2 shadow-[0_0_0_1px_rgba(251,117,252,0.16),0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-sm">
      <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.22em] text-brand-magenta-light">
        workspace files
      </p>
      <div className="border-t border-white/10 pt-1">
        {loading && matches.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-text-muted">Indexing workspace…</p>
        ) : matches.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-text-muted">
            {query.trim() ? "No matching files" : "No files in workspace"}
          </p>
        ) : (
          matches.map((entry, index) => {
            const active = index === selectedIndex;
            const Icon = kindIcon(entry.kind);
            return (
              <div
                key={entry.path}
                className="cursor-pointer px-2 py-1.5"
                onMouseEnter={() => onHover(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(entry);
                }}
                style={{
                  background: active
                    ? "linear-gradient(90deg, rgba(251,117,252,0.24), rgba(138,56,245,0.14) 70%, rgba(138,56,245,0.04))"
                    : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px rgba(251,117,252,0.34)" : "none",
                }}
              >
                <div className="flex items-start gap-2">
                  <Icon size={13} className="mt-0.5 shrink-0 text-brand-magenta-light" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold tracking-[0.04em] text-[#f8e7ff]">
                      {entry.basename}
                    </p>
                    <p className="truncate text-[11px] leading-4 tracking-[0.02em] text-[#bda6d3]">
                      {entry.path}
                      {entry.size > 0 ? ` · ${formatBytes(entry.size)}` : ""}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
