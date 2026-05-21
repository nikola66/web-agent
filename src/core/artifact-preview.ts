export type ArtifactKind =
  | "markdown"
  | "mermaid"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "docx"
  | "pptx"
  | "unsupported";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "txt"]);
const MERMAID_EXTENSIONS = new Set(["mmd", "mermaid"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);

const MIME_BY_EXT: Record<string, string> = {
  md: "text/markdown;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  mmd: "text/plain;charset=utf-8",
  mermaid: "text/plain;charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function fileExtension(filename: string): string {
  const base = String(filename || "").trim().split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function inferArtifactKind(filename: string): ArtifactKind {
  const ext = fileExtension(filename);
  if (!ext) return "unsupported";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (MERMAID_EXTENSIONS.has(ext)) return "mermaid";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  return "unsupported";
}

export function mimeForArtifactKind(kind: ArtifactKind, filename: string): string {
  const ext = fileExtension(filename);
  if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  switch (kind) {
    case "markdown":
      return "text/markdown;charset=utf-8";
    case "mermaid":
      return "text/plain;charset=utf-8";
    case "image":
      return "image/*";
    case "audio":
      return "audio/*";
    case "video":
      return "video/*";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "application/octet-stream";
  }
}

export function unsupportedPreviewMessage(filename: string): string {
  const ext = fileExtension(filename);
  if (ext === "doc") {
    return "Legacy .doc files cannot be previewed in the browser. Download the file or convert to .docx.";
  }
  if (ext === "ppt") {
    return "Legacy .ppt files cannot be previewed in the browser. Download the file or convert to .pptx.";
  }
  return "Preview is not supported for this file type. Use Download to save a local copy.";
}
