const RAW_ALLOWED_UPLOAD_EXTENSIONS = [
  "txt",
  "md",
  "json",
  "csv",
  "tsv",
  "pdf",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "css",
  "html",
  "xml",
  "yml",
  "yaml",
  "toml",
  "env",
  "sh",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "php",
  "sql",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "heic",
  "heif",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "mp4",
  "webm",
  "mov",
  "m4v",
]
  .map((ext) => String(ext).trim().toLowerCase().replace(/^\.+/, ""))
  .filter(Boolean);

export const ALLOWED_UPLOAD_EXTENSIONS = new Set(RAW_ALLOWED_UPLOAD_EXTENSIONS);

export function isAllowedUploadFile(name: string): boolean {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0 || dot === trimmed.length - 1) return false;
  return ALLOWED_UPLOAD_EXTENSIONS.has(trimmed.slice(dot + 1).toLowerCase());
}
