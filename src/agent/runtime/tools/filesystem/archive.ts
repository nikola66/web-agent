/**
 * Archive inspection / extraction for the Nodebox runtime.
 *
 * Pure JS — no npm deps. Uses only `node:fs/promises`, `node:path`,
 * `node:zlib`. Supports:
 *   - ZIP   (store + deflate)        — by extension `.zip` or magic `PK\x03\x04`
 *   - GZIP  (single-stream)          — `.gz`/`.tgz`/`.tar.gz` or magic `\x1f\x8b`
 *   - TAR   (ustar/posix headers)    — `.tar` (or after gunzip of `.tar.gz`)
 *
 * Intentionally not supported: zip64, zipcrypto, lzma/zstd in zip, multi-stream
 * gzip, sparse tar. The agent should fall back to `run_shell node ...` if it
 * needs something exotic.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import zlib from "node:zlib";
import {
  resolveWorkspacePath,
  assertAllowedWorkspaceWritePath,
  ensureParentDir,
} from "../../workspace-paths.js";

export type ArchiveEntry = {
  name: string;
  size: number;
  compressedSize: number;
  isDir: boolean;
  method: "store" | "deflate" | "tar";
};

type ParsedArchive = {
  format: "zip" | "tar";
  entries: ArchiveEntry[];
  /** Extract a single entry's bytes (decompressed). */
  read(name: string): Buffer;
};

function detectFormat(buf: Buffer, archivePath: string): "zip" | "tar.gz" | "tar" {
  const lower = archivePath.toLowerCase();
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "zip";
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return "tar.gz";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".tar")) return "tar";
  // Tar has no magic in pre-ustar; check ustar marker at offset 257.
  if (buf.length >= 263 && buf.slice(257, 263).toString("ascii").startsWith("ustar")) return "tar";
  throw new Error(`Unrecognized archive format for ${archivePath} (no zip/gzip/tar signature)`);
}

// ---------- ZIP ----------

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEocdOffset(buf: Buffer): number {
  // EOCD is at least 22 bytes; comment can extend it up to 65557 from end.
  const maxBack = Math.min(buf.length, 65557);
  for (let i = buf.length - 22; i >= buf.length - maxBack; i--) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

function parseZip(buf: Buffer): ParsedArchive {
  const eocd = findEocdOffset(buf);
  const cdirSize = buf.readUInt32LE(eocd + 12);
  const cdirOffset = buf.readUInt32LE(eocd + 16);
  if (cdirOffset === 0xffffffff || cdirSize === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported");
  }

  const entries: ArchiveEntry[] = [];
  // Local-header offsets keyed by entry name.
  const localOffsets = new Map<string, number>();

  let p = cdirOffset;
  while (p < cdirOffset + cdirSize) {
    if (buf.readUInt32LE(p) !== CDIR_SIG) {
      throw new Error(`ZIP central directory corrupted at ${p}`);
    }
    const compMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const isDir = name.endsWith("/");

    let method: ArchiveEntry["method"];
    if (compMethod === 0) method = "store";
    else if (compMethod === 8) method = "deflate";
    else throw new Error(`ZIP entry '${name}' uses unsupported compression method ${compMethod}`);

    entries.push({
      name,
      size: uncompressedSize,
      compressedSize,
      isDir,
      method,
    });
    localOffsets.set(name, localHeaderOffset);
    p += 46 + nameLen + extraLen + commentLen;
  }

  const read = (entryName: string): Buffer => {
    const off = localOffsets.get(entryName);
    if (off === undefined) throw new Error(`ZIP entry not found: ${entryName}`);
    if (buf.readUInt32LE(off) !== LFH_SIG) {
      throw new Error(`ZIP local file header missing for ${entryName}`);
    }
    const lfhCompressedSize = buf.readUInt32LE(off + 18);
    const lfhNameLen = buf.readUInt16LE(off + 26);
    const lfhExtraLen = buf.readUInt16LE(off + 28);
    const dataStart = off + 30 + lfhNameLen + lfhExtraLen;
    const compressed = buf.slice(dataStart, dataStart + lfhCompressedSize);
    const entry = entries.find((e) => e.name === entryName)!;
    if (entry.method === "store") return compressed;
    return zlib.inflateRawSync(compressed);
  };

  return { format: "zip", entries, read };
}

// ---------- TAR ----------

function readOctal(buf: Buffer, offset: number, len: number): number {
  // POSIX tar fields are NUL/space terminated octal strings.
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf[offset + i];
    if (c === 0 || c === 0x20) break;
    s += String.fromCharCode(c);
  }
  if (!s) return 0;
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

function readNulString(buf: Buffer, offset: number, len: number): string {
  let end = offset;
  const max = offset + len;
  while (end < max && buf[end] !== 0) end++;
  return buf.slice(offset, end).toString("utf8");
}

function parseTar(buf: Buffer): ParsedArchive {
  const entries: ArchiveEntry[] = [];
  // entryName -> { dataStart, dataLen, typeFlag }
  const dataIndex = new Map<string, { start: number; size: number; typeFlag: string }>();

  let p = 0;
  while (p + 512 <= buf.length) {
    const header = buf.slice(p, p + 512);
    // End-of-archive sentinel: a zero block. Two in a row is canonical, but
    // some writers emit only one — bail at the first.
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) { allZero = false; break; }
    }
    if (allZero) break;

    const name = readNulString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] || 0x30);
    const prefix = readNulString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const isDir = typeFlag === "5" || fullName.endsWith("/");

    // Skip PAX/GNU extended headers (typeFlag 'x', 'g', 'L', 'K') but still advance.
    if (typeFlag === "0" || typeFlag === "" || typeFlag === "\0" || typeFlag === "5" || typeFlag === "7" || typeFlag === "2") {
      entries.push({
        name: fullName,
        size,
        compressedSize: size,
        isDir,
        method: "tar",
      });
      dataIndex.set(fullName, { start: p + 512, size, typeFlag });
    }

    const padded = Math.ceil(size / 512) * 512;
    p += 512 + padded;
  }

  const read = (entryName: string): Buffer => {
    const info = dataIndex.get(entryName);
    if (!info) throw new Error(`TAR entry not found: ${entryName}`);
    return buf.slice(info.start, info.start + info.size);
  };

  return { format: "tar", entries, read };
}

// ---------- Public API ----------

export async function loadAndParseArchive(absPath: string): Promise<ParsedArchive> {
  let buf = await fs.readFile(absPath);
  const fmt = detectFormat(buf, absPath);
  if (fmt === "zip") return parseZip(buf);
  if (fmt === "tar.gz") {
    buf = zlib.gunzipSync(buf);
    return parseTar(buf);
  }
  return parseTar(buf);
}

function isPathInside(parent: string, child: string): boolean {
  const rel = nodePath.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !nodePath.isAbsolute(rel);
}

export type ExtractResult = {
  ok: true;
  archive: string;
  destination: string;
  format: "zip" | "tar";
  extractedFiles: number;
  extractedBytes: number;
  skipped: string[];
};

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024; // 256MB extracted total
const DEFAULT_MAX_FILES = 5000;

export async function extractArchive(
  ctx: unknown,
  args: {
    archive_path: string;
    destination?: string;
    max_bytes?: number;
    max_files?: number;
  }
): Promise<ExtractResult> {
  const relArchive = String(args.archive_path || "").trim();
  if (!relArchive) throw new Error("extract_archive requires `archive_path`");
  const relDest = String(
    args.destination || `${relArchive.replace(/\.(zip|tar\.gz|tgz|tar)$/i, "")}-extracted`
  ).trim();

  const absArchive = resolveWorkspacePath(ctx, relArchive);
  const absDest = resolveWorkspacePath(ctx, relDest);
  assertAllowedWorkspaceWritePath(absDest);

  const parsed = await loadAndParseArchive(absArchive);
  const maxBytes =
    typeof args.max_bytes === "number" && args.max_bytes > 0 ? args.max_bytes : DEFAULT_MAX_BYTES;
  const maxFiles =
    typeof args.max_files === "number" && args.max_files > 0 ? args.max_files : DEFAULT_MAX_FILES;

  await fs.mkdir(absDest, { recursive: true });

  let extractedFiles = 0;
  let extractedBytes = 0;
  const skipped: string[] = [];

  for (const entry of parsed.entries) {
    if (extractedFiles >= maxFiles) {
      skipped.push(`${entry.name} (max_files=${maxFiles} reached)`);
      continue;
    }
    if (extractedBytes + entry.size > maxBytes) {
      skipped.push(`${entry.name} (would exceed max_bytes=${maxBytes})`);
      continue;
    }

    // Normalize path separators, strip leading slashes, reject absolute / traversal.
    const cleaned = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!cleaned || cleaned.includes("..")) {
      skipped.push(`${entry.name} (path traversal blocked)`);
      continue;
    }
    const target = nodePath.join(absDest, cleaned);
    if (target !== absDest && !isPathInside(absDest, target)) {
      skipped.push(`${entry.name} (resolves outside destination)`);
      continue;
    }

    if (entry.isDir) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }

    await ensureParentDir(target);
    const data = parsed.read(entry.name);
    await fs.writeFile(target, data);
    extractedFiles += 1;
    extractedBytes += data.byteLength;
  }

  return {
    ok: true,
    archive: relArchive,
    destination: relDest,
    format: parsed.format,
    extractedFiles,
    extractedBytes,
    skipped,
  };
}

export type ListResult = {
  ok: true;
  archive: string;
  format: "zip" | "tar";
  totalEntries: number;
  totalUncompressedBytes: number;
  entries: ArchiveEntry[];
  truncated: boolean;
};

const DEFAULT_LIST_LIMIT = 500;

export async function listArchive(
  ctx: unknown,
  args: { archive_path: string; limit?: number }
): Promise<ListResult> {
  const relArchive = String(args.archive_path || "").trim();
  if (!relArchive) throw new Error("archive_list requires `archive_path`");
  const absArchive = resolveWorkspacePath(ctx, relArchive);
  const parsed = await loadAndParseArchive(absArchive);
  const limit =
    typeof args.limit === "number" && args.limit > 0
      ? Math.min(args.limit, 5000)
      : DEFAULT_LIST_LIMIT;
  const totalUncompressedBytes = parsed.entries.reduce((s, e) => s + e.size, 0);
  const truncated = parsed.entries.length > limit;
  return {
    ok: true,
    archive: relArchive,
    format: parsed.format,
    totalEntries: parsed.entries.length,
    totalUncompressedBytes,
    entries: parsed.entries.slice(0, limit),
    truncated,
  };
}
