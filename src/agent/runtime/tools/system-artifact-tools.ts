/**
 * Lightweight system introspection, file helpers, and artifact presentation markers.
 */

import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { ARTIFACT_PRESENT_END, ARTIFACT_PRESENT_START, WS } from "../constants.js";
import { resolveWorkspacePath } from "../workspace-paths.js";

function simpleLineDiff(linesA, linesB, budget = 500) {
  const a = linesA;
  const b = linesB;
  const maxA = Math.min(a.length, 12_000);
  const maxB = Math.min(b.length, 12_000);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < maxA || j < maxB) {
    if (out.length >= budget) {
      out.push(`… diff truncated after ${budget} lines`);
      break;
    }
    const la = i < maxA ? a[i] : null;
    const lb = j < maxB ? b[j] : null;
    if (la === lb && la !== undefined) {
      out.push(`  ${la ?? ""}`);
      i += 1;
      j += 1;
      continue;
    }
    if (la !== undefined && lb !== undefined && la !== lb) {
      out.push(`- ${la}`);
      out.push(`+ ${lb}`);
      i += 1;
      j += 1;
      continue;
    }
    if (la !== undefined) {
      out.push(`- ${la}`);
      i += 1;
    } else if (lb !== undefined) {
      out.push(`+ ${lb}`);
      j += 1;
    } else {
      break;
    }
  }
  return out.join("\n");
}

export async function systemInfoTool(_args, _ctx) {
  const base = {
    ok: true,
    time: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    uptimeSec: Math.round(os.uptime()),
    loadavg: typeof os.loadavg === "function" ? os.loadavg() : null,
    freemem: os.freemem(),
    totalmem: os.totalmem(),
    platform: os.platform(),
    hostname: os.hostname(),
    cpus: Math.max(1, os.cpus()?.length || 1),
    node: process.version,
    cwd: process.cwd(),
  };


  try {
    if (typeof fs.statfs === "function") {
      const st = await fs.statfs(WS);
      const bsize = Number(st.bsize) || Number(st.frsize) || 4096;
      const bavail = Number(st.bavail ?? st.bfree) || 0;
      const blocks = Number(st.blocks) || 0;
      base.workspaceStatfs = {
        approxBytesAvailable: bavail * bsize,
        approxBytesTotal: blocks * bsize,
      };
    }
  } catch {
    /* WebContainer / older Node may omit statfs */
  }

  return base;
}

export async function fileDiffTool(args = {}, ctx) {
  const pathA = typeof args?.path_a === "string" ? args.path_a.trim() : "";
  const pathB = typeof args?.path_b === "string" ? args.path_b.trim() : "";
  if (!pathA || !pathB) {
    throw new Error("`path_a` and `path_b` are required (workspace-relative paths).");
  }
  const absA = resolveWorkspacePath(ctx, pathA);
  const absB = resolveWorkspacePath(ctx, pathB);
  let rawA, rawB;
  try {
    rawA = await fs.readFile(absA, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${pathA}. Confirm path via list_dir before retrying.`);
    }
    throw err;
  }
  try {
    rawB = await fs.readFile(absB, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${pathB}. Confirm path via list_dir before retrying.`);
    }
    throw err;
  }
  const linesA = rawA.split(/\r?\n/);
  const linesB = rawB.split(/\r?\n/);
  const diff = simpleLineDiff(linesA, linesB, 500);
  return {
    ok: true,
    path_a: pathA,
    path_b: pathB,
    lines_a: linesA.length,
    lines_b: linesB.length,
    diff,
  };
}

export async function fileStatTool(args = {}, ctx) {
  const rel = typeof args?.path === "string" ? args.path.trim() : "";
  if (!rel) throw new Error("`path` is required.");
  const abs = resolveWorkspacePath(ctx, rel);
  let st;
  try {
    st = await fs.stat(abs);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${rel}. Use list_dir to confirm exact path and casing.`);
    }
    throw err;
  }
  return {
    ok: true,
    path: rel,
    size: st.size,
    mtimeMs: st.mtimeMs,
    birthtimeMs: st.birthtimeMs,
    isFile: st.isFile(),
    isDirectory: st.isDirectory(),
    mode: st.mode,
  };
}

export async function artifactPresentTool(args = {}, ctx) {
  const title = String(args?.title ?? "Document").trim() || "Document";
  let filename = String(args?.filename ?? "artifact.md").trim() || "artifact.md";
  const markdownRaw = args?.markdown;
  const markdown = typeof markdownRaw === "string" ? markdownRaw : String(markdownRaw ?? "");
  if (!markdown.trim()) throw new Error("`markdown` is required for artifact_present.");
  const capped = markdown.length > 200_000 ? `${markdown.slice(0, 200_000)}\n\n…truncated…` : markdown;
  filename = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "artifact.md";
  if (!filename.endsWith(".md")) filename = `${filename}.md`;
  const payload = {
    title: title.slice(0, 200),
    filename,
    markdown: capped,
  };
  process.stdout.write(
    `${ARTIFACT_PRESENT_START}${JSON.stringify(payload)}${ARTIFACT_PRESENT_END}\n`
  );
  if (typeof ctx?.services?.sendDocument === "function") {
    await ctx.services.sendDocument({ title: payload.title, filename: payload.filename, content: capped }).catch(() => {});
  }
  return {
    ok: true,
    title: payload.title,
    filename: payload.filename,
    bytes: Buffer.byteLength(payload.markdown, "utf8"),
    note: "The host UI should offer View / Download for this artifact marker.",
  };
}
