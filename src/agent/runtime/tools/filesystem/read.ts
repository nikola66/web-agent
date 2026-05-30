/**
 * File reading tool.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  resolveWorkspacePath,
  normalizeWorkspaceRelativePath,
} from "../../workspace-paths.js";
import { errorMessage } from "../../utils.js";
import {
  SNAPSHOT_READ_UNWRAP_MAX_CHARS,
  unwrapMemorySnapshotReadContent,
} from "../../memory/snapshots.js";
import {
  htmlApiBodyRecoveryNote,
  looksLikeHtmlDocument,
} from "../../tool-result-preview.js";
import {
  isMemoryRunArchivePath,
  isMemorySnapshotSpillPath,
  memoryRunArchiveBlockedMessage,
} from "../../memory/internal-paths.js";
import { toolPathStringFromArgs, withPathHints } from "./path-hints.js";

async function snapshotJsonPeers(absFilePath, limit = 44) {
  const parentAbs = nodePath.dirname(absFilePath);
  let names = [];
  try {
    names = await fs.readdir(parentAbs);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);
}

/**
 * Map a workspace path's extension to the dedicated tool for that binary/media
 * type. read_file decodes utf8, which corrupts these formats and returns
 * mojibake (the agent then "succeeds" on garbage). Short-circuit with a
 * recovery message naming the right tool instead. Returns null for
 * text-readable files. Pure + exported for unit testing.
 */
const BINARY_READ_TOOL_HINTS: Array<{ re: RegExp; hint: string }> = [
  {
    re: /\.(?:zip|tar|tgz|tar\.gz)$/i,
    hint: "extract it with `extract_archive` (ZIP/TAR/TGZ) or inspect entries with `archive_list` — read_file cannot decode archive bytes, and Nodebox has no POSIX `unzip`/`tar`. Do not run_python zipfile to EXTRACT (os.listdir/binary reads raise JsProxy errors in Pyodide)",
  },
  { re: /\.pdf$/i, hint: "extract text with `pdf_extract` — read_file returns raw PDF bytes, not text" },
  {
    re: /\.docx$/i,
    hint: "extract text with `docx_extract` — a .docx is a zipped XML bundle, not plain text",
  },
  {
    re: /\.(?:png|jpe?g|gif|webp|bmp|heic|heif|tiff?|ico)$/i,
    hint: "analyze it with `vision_analyze`, or get dimensions/metadata with `image_info` — read_file cannot decode image bytes",
  },
  {
    re: /\.(?:mp3|wav|m4a|aac|ogg|flac|opus)$/i,
    hint: "transcribe/analyze it with `audio_analyze` — read_file cannot decode audio bytes",
  },
  {
    re: /\.(?:mp4|mov|webm|mkv|avi)$/i,
    hint: "extract audio then `audio_analyze`; for a YouTube URL use `youtube_transcribe` — read_file cannot decode video bytes",
  },
];

export function binaryReadRecovery(rel: string): string | null {
  const path = String(rel || "").trim().toLowerCase();
  if (!path) return null;
  for (const { re, hint } of BINARY_READ_TOOL_HINTS) {
    if (re.test(path)) {
      return `'${rel}' is a binary file — ${hint}. See skill (action=view) on browser-runtime-map for the full tool picker.`;
    }
  }
  return null;
}

export function getReadFileMaxChars() {
  const n = Number(process.env.WEBAGENT_READ_FILE_MAX_CHARS);
  if (Number.isFinite(n) && n >= 1000) return Math.floor(n);
  return SNAPSHOT_READ_UNWRAP_MAX_CHARS;
}

function snapshotReadFailure(rel: string, content: string): Error | null {
  if (!isMemorySnapshotSpillPath(rel)) return null;
  const trimmed = content.trimStart();
  if (looksLikeHtmlDocument(trimmed)) {
    return new Error(
      `${htmlApiBodyRecoveryNote(trimmed)} Do not JSON.parse this spill — rerun web_fetch/web_post with Authorization headers.`
    );
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(content);
    } catch (e) {
      return new Error(
        `Snapshot spill is not valid JSON (${errorMessage(e)}). Rerun web_fetch with limit/sort/fields — do not read_file this path again.`
      );
    }
  }
  return null;
}

function formatReadFileSuccess(rel: string, content: string) {
  const spillErr = snapshotReadFailure(rel, content);
  if (spillErr) throw spillErr;

  const unwrapped = isMemorySnapshotSpillPath(rel)
    ? unwrapMemorySnapshotReadContent(rel, content)
    : null;
  if (unwrapped) {
    return {
      ok: true,
      path: rel,
      bytes: Buffer.byteLength(unwrapped.content, "utf8"),
      ...unwrapped,
    };
  }
  const maxChars = getReadFileMaxChars();
  const totalBytes = Buffer.byteLength(content, "utf8");
  if (content.length > maxChars) {
    return {
      ok: true,
      path: rel,
      bytes: maxChars,
      total_bytes: totalBytes,
      content: `${content.slice(0, maxChars)}\n...[truncated at ${maxChars} chars; use grep or a narrower path]`,
      content_truncated: true,
    };
  }
  return {
    ok: true,
    path: rel,
    bytes: totalBytes,
    content,
  };
}

export async function readFileTool(args = {}, ctx) {
  const rel =
    typeof args.path === "string" && args.path.trim()
      ? args.path.trim()
      : toolPathStringFromArgs(args);
  if (!rel) {
    throw new Error(
      "read_file requires `path` (string), or an alias: `filename`, `file`, `file_path`, `target`"
    );
  }

  const normalized = normalizeWorkspaceRelativePath(rel).replace(/\\/g, "/");
  if (isMemoryRunArchivePath(normalized)) {
    throw new Error(memoryRunArchiveBlockedMessage(normalized));
  }
  const binaryHint = binaryReadRecovery(normalized);
  if (binaryHint) throw new Error(binaryHint);

  async function innerReadFile() {
    const abs = resolveWorkspacePath(ctx, rel);
    return fs.readFile(abs, "utf8");
  }

  try {
    const content = await withPathHints(innerReadFile, ctx, rel);
    return formatReadFileSuccess(normalized, content);
  } catch (e) {
    if (!isMemorySnapshotSpillPath(normalized)) throw e;

    let peers = [];
    try {
      peers = await snapshotJsonPeers(resolveWorkspacePath(ctx, rel));
    } catch {
      peers = [];
    }

    const head = errorMessage(e);
    const bn = nodePath.basename(rel);
    const reqParts = bn.match(/^run_(\d+)_(.+)_r(\d+)_0\.json$/);
    if (reqParts && peers.length) {
      const slug = reqParts[2];
      const round = reqParts[3];
      const matches = peers.filter((p) => {
        const m = p.match(/^run_(\d+)_(.+)_r(\d+)_0\.json$/);
        return m && m[2] === slug && m[3] === round;
      });
      if (matches.length === 1 && matches[0] !== bn) {
        const fixedRel = `memory/snapshots/${matches[0]}`;
        try {
          const content = await fs.readFile(resolveWorkspacePath(ctx, fixedRel), "utf8");
          return {
            ...formatReadFileSuccess(fixedRel, content),
            remapped_from: rel,
          };
        } catch {
          /* fall through */
        }
      }
    }
    const recovery =
      "Stale snapshot spill: workspace history may have been compacted, the path never existed for this run id, or the path duplicates an outdated turn.\nFollow `result_ref` strings exactly from the most recent preceding \"Tool results (compact JSON)\" user message — never invent run ids.\nIf no valid result_ref matches, rerun the originating tool (`web_fetch`, etc.) instead of re-reading this path.";
    const suffix = peers.length
      ? `\nJSON files presently in memory/snapshots/: ${peers.join(", ")}`
      : `\nmemory/snapshots/ is empty — nothing left to reopen; rerun the originating tool.`;

    throw new Error(`${head}\n${recovery}${suffix}`);
  }
}
