/**
 * File writing and editing tools.
 */

import fs from "node:fs/promises";
import {
  resolveWorkspacePath,
  assertAllowedWorkspaceWritePath,
  ensureParentDir,
} from "../../workspace-paths.js";
import { toolPathStringFromArgs, withPathHints } from "./path-hints.js";

function coerceWriteContent(raw) {
  if (typeof raw === "string") return raw;
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

export async function writeFileTool(args = {}, ctx) {
  const rel =
    typeof args.path === "string" && args.path.trim()
      ? args.path.trim()
      : toolPathStringFromArgs(args);
  if (!rel) {
    throw new Error(
      "write_file requires `path` (string), or an alias: `filename`, `file`, `file_path`, `target`"
    );
  }
  const raw =
    args.contents !== undefined
      ? args.contents
      : args.content !== undefined
      ? args.content
      : args.text !== undefined
      ? args.text
      : args.data;
  const contents = coerceWriteContent(raw);
  const abs = resolveWorkspacePath(ctx, rel);
  assertAllowedWorkspaceWritePath(abs);
  await ensureParentDir(abs);
  await fs.writeFile(abs, contents, "utf8");
  return {
    ok: true,
    path: rel,
    bytes: Buffer.byteLength(contents, "utf8"),
  };
}

export async function editFileTool(
  {
    path: rel,
    find,
    replace,
    old,
    new: next,
    new_content: newContent,
    content,
    text,
  },
  ctx
) {
  const abs = resolveWorkspacePath(ctx, rel);
  assertAllowedWorkspaceWritePath(abs);
  const from = find !== undefined ? find : old;
  const to = replace !== undefined ? replace : next;

  const fullReplace =
    from === undefined
      ? newContent !== undefined
        ? newContent
        : content !== undefined
        ? content
        : text
      : undefined;

  if (from === undefined) {
    if (typeof fullReplace !== "string") {
      throw new Error(
        "edit_file requires either (`find` and `replace`) or a full-file `new_content` string."
      );
    }
    await fs.writeFile(abs, fullReplace, "utf8");
    return { ok: true, replacements: 1, mode: "full_replace" };
  }

  if (typeof from !== "string") throw new Error("edit_file requires `find` (or alias `old`) as a string");
  if (typeof to !== "string") throw new Error("edit_file requires `replace` (or alias `new`) as a string");
  let s = await withPathHints(async () => fs.readFile(abs, "utf8"), ctx, rel);
  if (!s.includes(from)) throw new Error("find string not found");
  const n = s.split(from).length - 1;
  s = s.replace(from, to);
  await fs.writeFile(abs, s, "utf8");
  return { ok: true, replacements: n };
}

export async function multiEditTool({ path: rel, edits }, ctx) {
  let normalizedEdits = edits;
  if (typeof normalizedEdits === "string") {
    try {
      normalizedEdits = JSON.parse(normalizedEdits);
    } catch {
      throw new Error("multi_edit requires `edits` as an array or a valid JSON array string.");
    }
  }
  if (!Array.isArray(normalizedEdits) || normalizedEdits.length === 0) {
    throw new Error("multi_edit requires non-empty `edits` array.");
  }

  const abs = resolveWorkspacePath(ctx, rel);
  assertAllowedWorkspaceWritePath(abs);
  let s = await withPathHints(async () => fs.readFile(abs, "utf8"), ctx, rel);
  let total = 0;
  for (const [index, edit] of normalizedEdits.entries()) {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
      throw new Error(`multi_edit edit #${index + 1} must be an object with string \`find\` and \`replace\`.`);
    }
    const { find, replace } = edit;
    if (typeof find !== "string" || typeof replace !== "string") {
      throw new Error(`multi_edit edit #${index + 1} must provide string \`find\` and \`replace\`.`);
    }
    if (!s.includes(find)) throw new Error(`find not found: ${find.slice(0, 80)}`);
    const c = s.split(find).length - 1;
    s = s.replaceAll(find, replace);
    total += c;
  }
  await fs.writeFile(abs, s, "utf8");
  return { ok: true, replacements: total };
}

export async function applyPatchTool({ patch }, ctx) {
  if (typeof patch !== "string" || !patch.trim()) {
    throw new Error("apply_patch requires `patch` (non-empty string).");
  }
  const lines = patch.split(/\r?\n/);
  if (!lines.some((line) => line.startsWith("*** Begin Patch"))) {
    throw new Error("Invalid patch format: missing `*** Begin Patch`.");
  }
  let i = 0;
  const out = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("*** Add File:")) {
      const rel = line.slice("*** Add File:".length).trim();
      if (!rel) throw new Error("Add File operation missing target path.");
      i++;
      const chunk = [];
      while (i < lines.length && !lines[i].startsWith("***")) {
        chunk.push(lines[i]);
        i++;
      }
      const contentLines = [];
      for (const cl of chunk) {
        if (cl.startsWith("+")) contentLines.push(cl.slice(1));
      }
      const contents = contentLines.join("\n");
      const abs = resolveWorkspacePath(ctx, rel);
      assertAllowedWorkspaceWritePath(abs);
      await ensureParentDir(abs);
      await fs.writeFile(abs, contents, "utf8");
      out.push(rel);
      continue;
    }
    if (line.startsWith("*** Update File:")) {
      const rel = line.slice("*** Update File:".length).trim();
      if (!rel) throw new Error("Update File operation missing target path.");
      i++;
      const chunk = [];
      while (i < lines.length && !lines[i].startsWith("***")) {
        chunk.push(lines[i]);
        i++;
      }
      const body = chunk.join("\n");
      const abs = resolveWorkspacePath(ctx, rel);
      assertAllowedWorkspaceWritePath(abs);
      let cur = await withPathHints(() => fs.readFile(abs, "utf8"), ctx, rel);
      const hunks = body.split(/^@@$/m).map((h) => h.trim()).filter(Boolean);
      if (hunks.length === 0) {
        throw new Error(`No patch hunks found for ${rel}.`);
      }
      for (const h of hunks) {
        const hLines = h.split(/\r?\n/);
        const oldLines = [];
        const newLines = [];
        for (const hl of hLines) {
          if (hl.startsWith("-") && !hl.startsWith("---")) oldLines.push(hl.slice(1));
          else if (hl.startsWith("+") && !hl.startsWith("+++")) newLines.push(hl.slice(1));
          else if (hl.startsWith(" ") || hl === "") {
            oldLines.push(hl.startsWith(" ") ? hl.slice(1) : hl);
            newLines.push(hl.startsWith(" ") ? hl.slice(1) : hl);
          }
        }
        const oldBlock = oldLines.join("\n");
        const newBlock = newLines.join("\n");
        if (!cur.includes(oldBlock)) throw new Error(`Patch context not found in ${rel}`);
        cur = cur.replace(oldBlock, newBlock);
      }
      await fs.writeFile(abs, cur, "utf8");
      out.push(rel);
    } else i++;
  }
  if (out.length === 0) {
    throw new Error("No file operations found in patch. Use `*** Add File:` and/or `*** Update File:` blocks.");
  }
  return { files: out };
}
