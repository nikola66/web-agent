/**
 * PARA + Obsidian-style wiki vault tools (wiki_setup, wiki_sync, wiki_search).
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import {
  assertAllowedWorkspaceWritePath,
  ensureParentDir,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../workspace-paths.js";
import { shouldSkipDir } from "./filesystem/path-utils.js";
import * as memoryModule from "../memory/index.js";

type ToolCtx = { cwd?: string; services?: { memory?: typeof memoryModule } };

function memoryServices(ctx: ToolCtx | null | undefined) {
  return ctx?.services?.memory ?? memoryModule;
}

/** Avoid throwing when tests or hosts pass a partial `services.memory` stub. */
async function safeGetAllFacts(mem: typeof memoryModule): Promise<Awaited<ReturnType<typeof memoryModule.getAllFacts>>> {
  if (typeof mem.getAllFacts !== "function") return [];
  return mem.getAllFacts();
}

async function safeGetPromotableLearnings(
  mem: typeof memoryModule,
  limit: number
): Promise<Awaited<ReturnType<typeof memoryModule.getPromotableLearnings>>> {
  if (typeof mem.getPromotableLearnings !== "function") return [];
  return mem.getPromotableLearnings(limit);
}

/** Canonical wiki vault root (per-agent workspace; hidden state directory). */
export const WIKI_DEFAULT_ROOT = ".webagent/knowledge-vault";

/** Legacy default before agent-scoped migration (implicit-default only). */
const WIKI_LEGACY_ROOT = "knowledge-vault";

function posixJoin(...parts: string[]) {
  return nodePath.posix.join(...parts.map((p) => String(p).replace(/\\/g, "/")));
}

function knowledgeVaultBaseRel(rootRel: string) {
  return posixJoin(rootRel, "Resources", "KnowledgeVault");
}

type WikiRootResolution = { rootRel: string; implicitDefault: boolean };

function wikiRootFromArgs(args: Record<string, unknown> | undefined): WikiRootResolution {
  const raw = args?.root_path;
  const trimmed = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!trimmed) {
    return {
      rootRel: normalizeWorkspaceRelativePath(WIKI_DEFAULT_ROOT),
      implicitDefault: true,
    };
  }
  return {
    rootRel: normalizeWorkspaceRelativePath(trimmed),
    implicitDefault: false,
  };
}

type WikiMigrationMeta = { migrated_from?: string; migration_note?: string };

async function maybeMigrateLegacyWikiVault(
  ctx: ToolCtx | null,
  implicitDefault: boolean
): Promise<WikiMigrationMeta> {
  if (!implicitDefault) return {};
  const legacyRel = normalizeWorkspaceRelativePath(WIKI_LEGACY_ROOT);
  const newRel = normalizeWorkspaceRelativePath(WIKI_DEFAULT_ROOT);
  if (legacyRel === newRel) return {};

  const legacyAbs = resolveWorkspacePath(ctx, legacyRel);
  const newAbs = resolveWorkspacePath(ctx, newRel);

  let legacyExists = false;
  let newExists = false;
  try {
    await fs.stat(legacyAbs);
    legacyExists = true;
  } catch {
    /* absent */
  }
  try {
    await fs.stat(newAbs);
    newExists = true;
  } catch {
    /* absent */
  }

  if (!legacyExists) return {};

  if (newExists) {
    return {
      migration_note: `Legacy wiki vault exists at "${legacyRel}" but canonical vault is at "${newRel}"; using "${newRel}". Remove "${legacyRel}" manually if unused.`,
    };
  }

  await ensureParentDir(newAbs);
  await fs.rename(legacyAbs, newAbs);
  return {
    migrated_from: legacyRel,
    migration_note: `Moved wiki vault from "${legacyRel}" to "${newRel}".`,
  };
}

const INDEX_MARKERS = /<!--\s*WIKI_SYNC_START\s*-->[\s\S]*?<!--\s*WIKI_SYNC_END\s*-->/;

function isoStamp(d = new Date()) {
  return d.toISOString();
}

function wikiVaultReadme() {
  return `# Knowledge vault (PARA)

This vault follows Tiago Forte's **PARA** layout:

| Folder | Purpose |
| --- | --- |
| **Projects** | Short-term efforts with a concrete outcome and deadline |
| **Areas** | Ongoing responsibilities without a fixed end date |
| **Resources** | Topics and reference material for future use |
| **Archives** | Inactive items moved out of the active three |

Wiki notes (Obsidian-friendly) live under \`Resources/KnowledgeVault/\`.

See also: [PARA Method](https://fortelabs.co/para/), [Building a Second Brain](https://fortelabs.com/blog/basboverview).
`;
}

function wikiIndexTemplate() {
  return `---
title: Wiki Index
type: index
tags: [wiki, index]
updated: PLACEHOLDER_DATE
---

# Wiki Index

Central map for the knowledge wiki under this folder.

## Latest runtime sync

<!-- WIKI_SYNC_START -->
*(No sync yet — run \`wiki_sync\`.)*
<!-- WIKI_SYNC_END -->

## Quick links

- [[log]]
- [[sources/README|Sources]]
- [[entities/README|Entities]]
- [[concepts/README|Concepts]]
- [[synthesis/README|Synthesis]]
- [[ops/README|Ops]]
`;
}

function wikiLogTemplate() {
  return `---
title: Wiki Log
type: log
tags: [wiki, log]
---

# Log

Append-only timeline (\`wiki_sync\`, ingests, lint). Newest entries at bottom.
`;
}

function readmeStub(title: string, body: string) {
  return `---
title: ${title}
type: readme
tags: [wiki]
---

# ${title}

${body}
`;
}

async function safeWriteFile(
  absPath: string,
  content: string,
  overwrite: boolean
): Promise<"written" | "skipped"> {
  assertAllowedWorkspaceWritePath(absPath);
  await ensureParentDir(absPath);
  try {
    await fs.access(absPath);
    if (!overwrite) return "skipped";
  } catch {
    /* new file */
  }
  await fs.writeFile(absPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return "written";
}

/** Ensure wiki vault scaffold under workspace-relative \`rootRel\`. */
export async function wikiSetupTool(args: Record<string, unknown> = {}, ctx: ToolCtx | null = null) {
  const { rootRel, implicitDefault } = wikiRootFromArgs(args);
  const migration = await maybeMigrateLegacyWikiVault(ctx, implicitDefault);
  const mode = String(args?.mode ?? "para_plus_wiki").trim();
  const overwrite = Boolean(args?.overwrite);
  if (mode !== "para_plus_wiki") {
    throw new Error(`wiki_setup: unsupported mode "${mode}" (only para_plus_wiki).`);
  }

  const dirs = [
    posixJoin(rootRel, "Projects"),
    posixJoin(rootRel, "Areas"),
    posixJoin(rootRel, "Resources"),
    posixJoin(rootRel, "Archives"),
    posixJoin(rootRel, "Resources", "KnowledgeVault"),
    posixJoin(rootRel, "Resources", "KnowledgeVault", "sources"),
    posixJoin(rootRel, "Resources", "KnowledgeVault", "entities"),
    posixJoin(rootRel, "Resources", "KnowledgeVault", "concepts"),
    posixJoin(rootRel, "Resources", "KnowledgeVault", "synthesis"),
    posixJoin(rootRel, "Resources", "KnowledgeVault", "ops"),
  ];

  const ensured: string[] = [];
  for (const rel of dirs) {
    const abs = resolveWorkspacePath(ctx, rel);
    await fs.mkdir(abs, { recursive: true });
    ensured.push(rel);
  }

  const files: Array<{ rel: string; content: string }> = [
    { rel: posixJoin(rootRel, "README.md"), content: wikiVaultReadme() },
    {
      rel: posixJoin(rootRel, "Resources", "KnowledgeVault", "index.md"),
      content: wikiIndexTemplate().replace("PLACEHOLDER_DATE", isoStamp().slice(0, 10)),
    },
    { rel: posixJoin(rootRel, "Resources", "KnowledgeVault", "log.md"), content: wikiLogTemplate() },
    {
      rel: posixJoin(rootRel, "Resources", "KnowledgeVault", "sources", "README.md"),
      content: readmeStub("Sources", "One summary note per ingested source; link to entities and concepts."),
    },
    {
      rel: posixJoin(rootRel, "Resources", "KnowledgeVault", "entities", "README.md"),
      content: readmeStub("Entities", "People, orgs, products, places — atomic notes with evidence."),
    },
    {
      rel: posixJoin(rootRel, "Resources", "KnowledgeVault", "concepts", "README.md"),
      content: readmeStub("Concepts", "Ideas, frameworks, methods — definitions and tensions."),
    },
    {
      rel: posixJoin(rootRel, "Resources", "KnowledgeVault", "synthesis", "README.md"),
      content: readmeStub("Synthesis", "Cross-source comparisons and higher-level theses."),
    },
    {
      rel: posixJoin(rootRel, "Resources", "KnowledgeVault", "ops", "README.md"),
      content: readmeStub("Ops", "Lint reports, vault health, automated sync detail files."),
    },
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  for (const { rel, content } of files) {
    const abs = resolveWorkspacePath(ctx, rel);
    const status = await safeWriteFile(abs, content, overwrite);
    if (status === "written") written.push(rel);
    else skipped.push(rel);
  }

  await logDebugEvent("wiki_setup", { rootRel, written: written.length, skipped: skipped.length });
  return {
    ok: true,
    root_path: rootRel,
    mode,
    ensured_dirs: ensured,
    files_written: written,
    files_skipped: skipped,
    note: "Use wiki_sync to push runtime facts/session/learnings into index.md and log.md.",
    ...migration,
  };
}

function tokenizeQuery(q: string) {
  return String(q || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1)
    .slice(0, 24);
}

async function readSessionEntries(limit: number): Promise<Array<Record<string, unknown>>> {
  const sessionMemoryPath = workspaceStatePath(".webagent/session-memory.jsonl");
  let raw = "";
  try {
    raw = await fs.readFile(sessionMemoryPath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim());
  const slice = lines.slice(-limit);
  return slice.map((line) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return { parse_error: true, line: line.slice(0, 400) };
    }
  });
}

function formatFactsBlock(facts: Array<{ key?: string; value?: unknown }>) {
  if (!facts.length) return "_No facts in runtime store._";
  return facts
    .map((f) => {
      const v =
        typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value ?? "");
      return `- **${String(f.key ?? "")}**: ${v.slice(0, 500)}${v.length > 500 ? "…" : ""}`;
    })
    .join("\n");
}

function formatSessionBlock(entries: Array<Record<string, unknown>>) {
  if (!entries.length) return "_No session memory entries._";
  return entries
    .map((e) => {
      const ts = String(e.ts ?? "");
      const kind = String(e.kind ?? "");
      const text = String(e.text ?? "").slice(0, 600);
      return `- ${ts} [${kind}] ${text}${String(e.text ?? "").length > 600 ? "…" : ""}`;
    })
    .join("\n");
}

function formatLearningsBlock(
  rows: Array<{ category?: string; statement?: string; confidence?: number; evidence_count?: number }>
) {
  if (!rows.length) return "_No learnings rows._";
  return rows
    .map(
      (r) =>
        `- **[${String(r.category ?? "")}]** ${String(r.statement ?? "").slice(0, 480)} — conf=${Number(r.confidence ?? 0).toFixed(2)}, evidence=${r.evidence_count ?? 0}`
    )
    .join("\n");
}

/** Sync runtime memory projections into the wiki vault. */
export async function wikiSyncTool(args: Record<string, unknown> = {}, ctx: ToolCtx | null = null) {
  const { rootRel, implicitDefault } = wikiRootFromArgs(args);
  const migration = await maybeMigrateLegacyWikiVault(ctx, implicitDefault);
  const scopeRaw = String(args?.scope ?? "all").trim().toLowerCase();
  const scope = ["facts", "session", "all"].includes(scopeRaw) ? scopeRaw : "all";
  const maxItems = Math.min(200, Math.max(1, Number(args?.max_items ?? 40) || 40));

  const kvBase = knowledgeVaultBaseRel(rootRel);
  const indexRel = posixJoin(kvBase, "index.md");
  const logRel = posixJoin(kvBase, "log.md");
  const indexAbs = resolveWorkspacePath(ctx, indexRel);
  const logAbs = resolveWorkspacePath(ctx, logRel);

  try {
    await fs.access(resolveWorkspacePath(ctx, kvBase));
  } catch {
    throw new Error(
      `wiki_sync: KnowledgeVault not found under "${rootRel}". Run wiki_setup first (wiki_setup).`
    );
  }

  const memory = memoryServices(ctx);
  const facts =
    scope === "facts" || scope === "all"
      ? (await safeGetAllFacts(memory)).slice(0, maxItems)
      : [];
  const sessionEntries =
    scope === "session" || scope === "all" ? await readSessionEntries(maxItems) : [];
  const learnings =
    scope === "all"
      ? (await safeGetPromotableLearnings(memory, Math.min(maxItems, 20))).slice(0, maxItems)
      : [];

  const stamp = isoStamp();
  const stampFile = `wiki-sync-${stamp.replace(/[:.]/g, "-")}.md`;
  const opsRel = posixJoin(kvBase, "ops", stampFile);
  const opsLink = stampFile.replace(/\.md$/, "");

  const factsSection =
    scope === "facts" || scope === "all"
      ? formatFactsBlock(facts)
      : "_Skipped (scope does not include facts)._";
  const sessionSection =
    scope === "session" || scope === "all"
      ? formatSessionBlock(sessionEntries)
      : "_Skipped (scope does not include session)._";
  const learningsSection =
    scope === "all"
      ? formatLearningsBlock(learnings)
      : "_Skipped (scope is not `all`)._";

  const syncBody = [
    `# Runtime sync`,
    ``,
    `Stamp: ${stamp}`,
    `Scope: ${scope}`,
    ``,
    `## Facts`,
    ``,
    factsSection,
    ``,
    `## Session memory`,
    ``,
    sessionSection,
    ``,
    `## Learnings`,
    ``,
    learningsSection,
    ``,
  ].join("\n");

  const factsIndex =
    scope === "facts" || scope === "all"
      ? facts.length
        ? formatFactsBlock(facts.slice(0, 12))
        : "_None._"
      : "_Skipped (scope)._";
  const factsMore =
    scope === "facts" || scope === "all"
      ? facts.length > 12
        ? `\n_…${facts.length - 12} more in [[ops/${opsLink}|ops detail]]._\n`
        : ""
      : "";

  const sessionIndex =
    scope === "session" || scope === "all"
      ? sessionEntries.length
        ? formatSessionBlock(sessionEntries.slice(0, 8))
        : "_None._"
      : "_Skipped (scope)._";
  const sessionMore =
    scope === "session" || scope === "all"
      ? sessionEntries.length > 8
        ? `\n_…${sessionEntries.length - 8} more in ops detail._\n`
        : ""
      : "";

  const learningsIndex =
    scope === "all"
      ? learnings.length
        ? formatLearningsBlock(learnings.slice(0, 8))
        : "_None._"
      : "_Skipped (use scope=all for learnings)._";

  const indexSnippet = [
    `**Updated:** ${stamp} (scope=\`${scope}\`)`,
    ``,
    `### Facts (${scope === "facts" || scope === "all" ? facts.length : "—"})`,
    factsIndex,
    factsMore,
    ``,
    `### Session (${scope === "session" || scope === "all" ? sessionEntries.length : "—"})`,
    sessionIndex,
    sessionMore,
    ``,
    `### Learnings (${scope === "all" ? learnings.length : "—"})`,
    learningsIndex,
    ``,
    `_Full snapshot: [[ops/${opsLink}|${stampFile}]]_`,
  ].join("\n");

  let indexContent = "";
  try {
    indexContent = await fs.readFile(indexAbs, "utf8");
  } catch {
    indexContent = wikiIndexTemplate().replace("PLACEHOLDER_DATE", stamp.slice(0, 10));
  }

  let nextIndex: string;
  if (INDEX_MARKERS.test(indexContent)) {
    nextIndex = indexContent.replace(
      INDEX_MARKERS,
      `<!-- WIKI_SYNC_START -->\n${indexSnippet}\n<!-- WIKI_SYNC_END -->`
    );
  } else {
    nextIndex =
      indexContent.trimEnd() +
      `\n\n## Latest runtime sync\n\n<!-- WIKI_SYNC_START -->\n${indexSnippet}\n<!-- WIKI_SYNC_END -->\n`;
  }

  assertAllowedWorkspaceWritePath(indexAbs);
  await ensureParentDir(indexAbs);
  await fs.writeFile(indexAbs, nextIndex.endsWith("\n") ? nextIndex : `${nextIndex}\n`, "utf8");

  const logAppend = `\n## [${stamp}] wiki_sync\n\n- scope: \`${scope}\`\n- facts: ${facts.length}, session lines: ${sessionEntries.length}, learnings: ${learnings.length}\n- detail: [[ops/${opsLink}]]\n`;
  assertAllowedWorkspaceWritePath(logAbs);
  await ensureParentDir(logAbs);
  let logExisting = "";
  try {
    logExisting = await fs.readFile(logAbs, "utf8");
  } catch {
    logExisting = wikiLogTemplate();
  }
  await fs.writeFile(logAbs, `${logExisting.trimEnd()}${logAppend}\n`, "utf8");

  const opsAbs = resolveWorkspacePath(ctx, opsRel);
  assertAllowedWorkspaceWritePath(opsAbs);
  await ensureParentDir(opsAbs);
  await fs.writeFile(opsAbs, syncBody.endsWith("\n") ? syncBody : `${syncBody}\n`, "utf8");

  await logDebugEvent("wiki_sync", {
    rootRel,
    scope,
    facts: facts.length,
    session: sessionEntries.length,
    learnings: learnings.length,
  });

  return {
    ok: true,
    root_path: rootRel,
    scope,
    touched: [indexRel, logRel, opsRel],
    counts: {
      facts: facts.length,
      session_entries: sessionEntries.length,
      learnings: learnings.length,
    },
    ...migration,
  };
}

async function collectMarkdownFiles(absRoot: string, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    if (out.length >= maxFiles) return;
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".")) continue;
      if (shouldSkipDir(e.name)) continue;
      const p = nodePath.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.toLowerCase().endsWith(".md")) {
        out.push(p);
      }
    }
  }
  await walk(absRoot);
  return out;
}

function firstTokenOffset(haystackLc: string, tokens: string[]) {
  let best = -1;
  for (const t of tokens) {
    const idx = haystackLc.indexOf(t);
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best;
}

/** Search markdown under the wiki root; rank by token hits. */
export async function wikiSearchTool(args: Record<string, unknown> = {}, ctx: ToolCtx | null = null) {
  const query = String(args?.query ?? "").trim();
  if (!query) throw new Error("`query` is required for wiki_search.");
  const { rootRel, implicitDefault } = wikiRootFromArgs(args);
  const migration = await maybeMigrateLegacyWikiVault(ctx, implicitDefault);
  const limit = Math.min(50, Math.max(1, Number(args?.limit ?? 10) || 10));
  const maxFiles = Math.min(2000, Math.max(50, Number(args?.max_files ?? 500) || 500));

  const absRoot = resolveWorkspacePath(ctx, rootRel);
  let stat;
  try {
    stat = await fs.stat(absRoot);
  } catch {
    throw new Error(`wiki_search: vault root not found: ${rootRel}. Run wiki_setup first.`);
  }
  if (!stat.isDirectory()) throw new Error(`wiki_search: root_path must be a directory: ${rootRel}`);

  const tokens = tokenizeQuery(query);
  if (!tokens.length) {
    throw new Error("`query` must include at least one word with 2+ characters.");
  }

  const mdFiles = await collectMarkdownFiles(absRoot, maxFiles);
  type Hit = { path: string; score: number; snippet: string };
  const scored: Hit[] = [];
  const CONTEXT = 180;

  for (const abs of mdFiles) {
    let raw = "";
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    if (raw.length > 400_000) raw = raw.slice(0, 400_000);
    const low = raw.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      let pos = 0;
      while ((pos = low.indexOf(t, pos)) !== -1) {
        score += 1;
        pos += t.length;
      }
    }
    if (score === 0) continue;

    const off = firstTokenOffset(low, tokens);
    let snippet: string;
    if (off >= 0) {
      const start = Math.max(0, off - CONTEXT);
      const end = Math.min(raw.length, off + CONTEXT);
      snippet = raw.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) snippet = `…${snippet}`;
      if (end < raw.length) snippet = `${snippet}…`;
    } else {
      snippet = raw.replace(/\s+/g, " ").trim().slice(0, CONTEXT * 2);
    }

    scored.push({
      path: toWorkspaceRelative(abs),
      score,
      snippet,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const matches = scored.slice(0, limit);

  await logDebugEvent("wiki_search", {
    rootRel,
    query,
    mdFiles: mdFiles.length,
    hits: matches.length,
  });

  return {
    ok: true,
    root_path: rootRel,
    query,
    scanned_files: mdFiles.length,
    matches,
    ...migration,
  };
}
