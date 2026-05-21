import { useCallback, useState } from "react";
import { Download, Eye, X } from "lucide-react";
import { inferArtifactKind, mimeForArtifactKind } from "@/core/artifact-preview";
import { readWorkspaceFileBuffer, readWorkspaceFileText } from "@/core/workspace";
import { useProfileStore } from "../stores/profile-store";
import { useRuntimeStore } from "../stores/runtime-store";
import {
  ArtifactPreviewBody,
  ArtifactPreviewError,
  ArtifactPreviewLoading,
  artifactPreviewLabel,
} from "./artifact-preview/ArtifactPreviewBody";
import {
  buildArtifactDownloadBlob,
  useArtifactContent,
} from "./artifact-preview/useArtifactContent";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "artifact";
  a.click();
  URL.revokeObjectURL(url);
}

export function ArtifactOfferBar() {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const artifactOffer = useRuntimeStore((s) =>
    activeProfileId ? s.profileRuntime[activeProfileId]?.artifactOffer ?? null : null,
  );
  const setArtifactOffer = useRuntimeStore((s) => s.setArtifactOffer);
  const [modalOpen, setModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const offerWithKind = artifactOffer
    ? {
        ...artifactOffer,
        kind: artifactOffer.kind || inferArtifactKind(artifactOffer.filename),
      }
    : null;

  const content = useArtifactContent(activeProfileId, offerWithKind, modalOpen, reloadKey);

  const dismiss = () => {
    setModalOpen(false);
    if (activeProfileId) setArtifactOffer(activeProfileId, null);
  };

  const onDownload = useCallback(async () => {
    if (!artifactOffer || !offerWithKind) return;

    if (content.status === "ready") {
      try {
        const blob = buildArtifactDownloadBlob(offerWithKind, content);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = artifactOffer.filename || "artifact";
        a.click();
        URL.revokeObjectURL(url);
        return;
      } catch {
        /* fall through */
      }
    }

    if (artifactOffer.markdown) {
      const blob = new Blob([artifactOffer.markdown], {
        type: mimeForArtifactKind("markdown", artifactOffer.filename),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = artifactOffer.filename || "artifact.md";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (artifactOffer.path && activeProfileId) {
      try {
        const kind = offerWithKind.kind;
        const mimeType = mimeForArtifactKind(kind, artifactOffer.filename);
        if (kind === "markdown" || kind === "mermaid") {
          const text = await readWorkspaceFileText(activeProfileId, artifactOffer.path, { preferLive: true });
          const blob = new Blob([text], { type: mimeType });
          triggerBlobDownload(blob, artifactOffer.filename);
          return;
        }
        const buffer = await readWorkspaceFileBuffer(activeProfileId, artifactOffer.path, { preferLive: true });
        triggerBlobDownload(new Blob([buffer], { type: mimeType }), artifactOffer.filename);
      } catch {
        /* best effort */
      }
    }
  }, [activeProfileId, artifactOffer, content, offerWithKind]);

  const retry = () => setReloadKey((k) => k + 1);

  if (!activeProfileId || !artifactOffer || !offerWithKind) {
    return null;
  }

  const previewLabel = artifactPreviewLabel(offerWithKind.kind);

  return (
    <>
      <div
        className="pointer-events-auto fixed right-4 bottom-20 z-60 flex max-w-[min(480px,calc(100vw-32px))] flex-col gap-1.5 p-3"
        style={{
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
        }}
        role="status"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-tight text-text-primary truncate">
              {artifactOffer.title}
            </p>
            <p className="truncate text-[10px] text-text-muted">{artifactOffer.filename}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss artifact"
            className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
            onClick={() => dismiss()}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-[11px] font-medium transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
            }}
            onClick={() => setModalOpen(true)}
          >
            <Eye size={14} strokeWidth={1.5} aria-hidden /> View
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-[11px] font-medium transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{
              border: "1px solid var(--color-border-muted)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-brand-magenta-light)",
            }}
            onClick={onDownload}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden /> Download
          </button>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-70 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)" }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="fancy-scroll flex h-[min(88vh,900px)] w-full max-w-4xl flex-col overflow-hidden"
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-elevated)",
            }}
            role="dialog"
            aria-modal="true"
            aria-label={previewLabel}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">{artifactOffer.title}</p>
                <p className="truncate pt-0.5 text-[11px] text-text-muted">{artifactOffer.filename}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-sm px-2 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                  onClick={onDownload}
                >
                  Download
                </button>
                <button
                  type="button"
                  aria-label="Close preview"
                  className="rounded p-1 text-text-muted hover:text-text-primary"
                  onClick={() => setModalOpen(false)}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="fancy-scroll flex-1 overflow-auto px-4 py-4">
              {content.status === "loading" || content.status === "idle" ? (
                <ArtifactPreviewLoading />
              ) : null}
              {content.status === "error" ? (
                <ArtifactPreviewError message={content.message} onRetry={retry} />
              ) : null}
              {content.status === "ready" ? (
                <ArtifactPreviewBody content={content} filename={artifactOffer.filename} onRetry={retry} />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
