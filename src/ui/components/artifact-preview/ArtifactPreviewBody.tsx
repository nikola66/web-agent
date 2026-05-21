import type { ArtifactKind } from "@/core/artifact-preview";
import { unsupportedPreviewMessage } from "@/core/artifact-preview";
import { MarkdownArtifactPreview } from "./MarkdownArtifactPreview";
import { DocxArtifactPreview, PdfArtifactPreview, PptxArtifactPreview } from "./OfficeArtifactPreview";
import type { ArtifactContentState } from "./useArtifactContent";

function MediaPreview({
  kind,
  blobUrl,
  alt,
}: {
  kind: "image" | "audio" | "video";
  blobUrl: string;
  alt: string;
}) {
  if (kind === "image") {
    return (
      <img
        src={blobUrl}
        alt={alt}
        className="mx-auto max-h-[min(72vh,900px)] max-w-full rounded-md border border-white/10 object-contain"
      />
    );
  }
  if (kind === "audio") {
    return (
      <audio controls src={blobUrl} className="mx-auto w-full max-w-xl">
        <track kind="captions" />
      </audio>
    );
  }
  return (
    <video controls src={blobUrl} className="mx-auto max-h-[min(72vh,900px)] w-full max-w-4xl rounded-md border border-white/10">
      <track kind="captions" />
    </video>
  );
}

export function ArtifactPreviewBody({
  content,
  filename,
  onRetry,
}: {
  content: Extract<ArtifactContentState, { status: "ready" }>;
  filename: string;
  onRetry?: () => void;
}) {
  const { kind } = content;

  if (kind === "markdown" && content.text !== undefined) {
    return <MarkdownArtifactPreview text={content.text} />;
  }
  if (kind === "mermaid" && content.text !== undefined) {
    return <MarkdownArtifactPreview text={content.text} mermaidOnly />;
  }
  if ((kind === "image" || kind === "audio" || kind === "video") && content.blobUrl) {
    return <MediaPreview kind={kind} blobUrl={content.blobUrl} alt={filename} />;
  }
  if (kind === "pdf" && content.buffer) {
    return <PdfArtifactPreview buffer={content.buffer} />;
  }
  if (kind === "docx" && content.buffer) {
    return <DocxArtifactPreview buffer={content.buffer} />;
  }
  if (kind === "pptx" && content.buffer) {
    return <PptxArtifactPreview buffer={content.buffer} />;
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 text-center">
      <p className="text-sm text-text-muted">{unsupportedPreviewMessage(filename)}</p>
      {onRetry ? (
        <button
          type="button"
          className="mx-auto rounded-sm px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-[rgba(255,255,255,0.06)]"
          style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function artifactPreviewLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "markdown":
      return "Markdown artifact";
    case "mermaid":
      return "Mermaid diagram";
    case "image":
      return "Image preview";
    case "audio":
      return "Audio preview";
    case "video":
      return "Video preview";
    case "pdf":
      return "PDF preview";
    case "docx":
      return "Document preview";
    case "pptx":
      return "Presentation preview";
    default:
      return "Artifact preview";
  }
}

export function ArtifactPreviewLoading() {
  return <p className="py-8 text-center text-sm text-text-muted">Loading preview…</p>;
}

export function ArtifactPreviewError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 py-8 text-center">
      <p className="text-sm text-text-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          className="mx-auto rounded-sm px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-[rgba(255,255,255,0.06)]"
          style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
