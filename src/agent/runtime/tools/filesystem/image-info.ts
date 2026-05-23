/**
 * Read width/height/format from common image headers without decoding pixels.
 * Pure JS, supports PNG, JPEG, GIF, WebP, BMP.
 */

import fs from "node:fs/promises";
import { resolveWorkspacePath } from "../../workspace-paths.js";
import { toolPathStringFromArgs } from "./path-hints.js";

type ImageMeta = { format: string; width: number; height: number };

function parsePng(buf: Buffer): ImageMeta | null {
  if (buf.length < 24) return null;
  if (
    buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47 ||
    buf[4] !== 0x0d || buf[5] !== 0x0a || buf[6] !== 0x1a || buf[7] !== 0x0a
  ) return null;
  // IHDR starts at offset 8 (chunk length + "IHDR" + 13 bytes payload).
  if (buf.slice(12, 16).toString("ascii") !== "IHDR") return null;
  return {
    format: "png",
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function parseGif(buf: Buffer): ImageMeta | null {
  if (buf.length < 10) return null;
  const sig = buf.slice(0, 6).toString("ascii");
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  return {
    format: "gif",
    width: buf.readUInt16LE(6),
    height: buf.readUInt16LE(8),
  };
}

function parseBmp(buf: Buffer): ImageMeta | null {
  if (buf.length < 26) return null;
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  return {
    format: "bmp",
    width: buf.readInt32LE(18),
    height: Math.abs(buf.readInt32LE(22)),
  };
}

function parseWebp(buf: Buffer): ImageMeta | null {
  if (buf.length < 30) return null;
  if (buf.slice(0, 4).toString("ascii") !== "RIFF") return null;
  if (buf.slice(8, 12).toString("ascii") !== "WEBP") return null;
  const fourCC = buf.slice(12, 16).toString("ascii");
  if (fourCC === "VP8 ") {
    // Lossy VP8: width/height are 14 bits at offset 26.
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { format: "webp", width: w, height: h };
  }
  if (fourCC === "VP8L") {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { format: "webp", width, height };
  }
  if (fourCC === "VP8X") {
    // Extended: 24-bit little-endian width-1, height-1 at offset 24..30.
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { format: "webp", width: w, height: h };
  }
  return null;
}

function parseJpeg(buf: Buffer): ImageMeta | null {
  if (buf.length < 4) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) return null;
    // Skip fill bytes.
    while (buf[p] === 0xff && p < buf.length) p++;
    const marker = buf[p];
    p++;
    // Stand-alone markers (no length).
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    const segLen = buf.readUInt16BE(p);
    // SOFn markers carry dimensions (0xC0..0xCF except DHT 0xC4, DAC 0xCC, DNL 0xC8).
    if (
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    ) {
      // After segLen (2 bytes): precision (1), height (2), width (2).
      return {
        format: "jpeg",
        height: buf.readUInt16BE(p + 3),
        width: buf.readUInt16BE(p + 5),
      };
    }
    p += segLen;
  }
  return null;
}

export type ImageInfoResult = {
  ok: true;
  path: string;
  bytes: number;
  format: string;
  width: number;
  height: number;
};

export async function imageInfo(
  ctx: unknown,
  args: { path?: string; [key: string]: unknown } = {}
): Promise<ImageInfoResult> {
  const rel =
    (typeof args.path === "string" && args.path.trim()) ||
    toolPathStringFromArgs(args as Record<string, unknown>);
  if (!rel) throw new Error("image_info requires `path` (aliases: `file`, `file_path`, `filename`).");
  const abs = resolveWorkspacePath(ctx, rel);
  const buf = await fs.readFile(abs);
  const meta =
    parsePng(buf) ||
    parseJpeg(buf) ||
    parseGif(buf) ||
    parseWebp(buf) ||
    parseBmp(buf);
  if (!meta) {
    throw new Error(`image_info: unrecognized image format for ${rel} (supports PNG/JPEG/GIF/WebP/BMP)`);
  }
  return {
    ok: true,
    path: rel,
    bytes: buf.byteLength,
    format: meta.format,
    width: meta.width,
    height: meta.height,
  };
}
