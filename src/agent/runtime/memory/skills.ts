/**
 * Skill management in files.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  CAPABILITIES_DIR,
  SKILLS_DIR,
  WS,
} from "../constants.js";
import { errorMessage } from "../utils.js";
import {
  getSkillWriteOrigin,
  markAgentCreated,
  recordSkillPatch,
  isPinnedSkill,
  archiveSkillDirectory,
} from "../skill-provenance.js";

const SKILLS_CONTEXT_CHAR_BUDGET = 8_000;
const SKILL_INDEX_TRIGGERS_MAX_CHARS = 160;
const SKILL_FILE_NAME = "SKILL.md";

let _skillsContextBlockCache: string | null = null;
let _skillsContextBlockCacheKey = "";

export function invalidateSkillsContextCache(): void {
  _skillsContextBlockCache = null;
  _skillsContextBlockCacheKey = "";
}
const DEFAULT_SKILL_CATEGORY = "local";
const SKILL_SUPPORT_ROOTS = new Set(["references", "templates", "scripts", "assets"]);
const SKILL_SAFE_FILE_MAX_BYTES = 512 * 1024;
const BUNDLED_SKILLS_DIR = nodePath.join(CAPABILITIES_DIR, "skills");
const SOURCE_BUNDLED_SKILLS_DIR = nodePath.join(WS, "src", "capabilities", "skills");
const MAX_BULK_SKILL_ITEMS = 75;

type SkillMeta = Record<string, unknown>;

interface SkillRecord {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  triggers: string[];
  version: string;
  category: string;
  platforms: string[];
  allowedTools: string[];
  requiresTools: string[];
  path: string;
  dir: string;
  skillPath: string;
  source: string;
  body: string;
  raw: string;
}

type SkillListEntry = Omit<SkillRecord, "dir" | "skillPath" | "body" | "raw">;

function skillSlug(name: unknown): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function skillCategorySlug(category: unknown): string {
  return skillSlug(category) || DEFAULT_SKILL_CATEGORY;
}

function parseInlineList(value: unknown): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseSkillFrontmatter(raw: string): { meta: SkillMeta; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: SkillMeta = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!kv) continue;
    const [, k, rawValue = ""] = kv;
    const v = rawValue.trim();
    if (v === "|" || v === ">") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].replace(/^\s{2,}/, ""));
      }
      meta[k] = v === ">" ? block.join(" ").trim() : block.join("\n").trim();
    } else if (v === "") {
      const list: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i += 1;
        list.push(lines[i].replace(/^\s*-\s+/, "").trim());
      }
      meta[k] = list.length ? list : "";
    } else if (["tags", "triggers", "allowed-tools", "requires-tools", "requires_tools", "platforms", "required_environment_variables"].includes(k)) {
      meta[k] = parseInlineList(v);
    } else {
      meta[k] = v.replace(/^["']|["']$/g, "").trim();
    }
  }
  return { meta, body: match[2].trim() };
}

function buildSkillFileContent({
  name,
  description,
  version = "1.0.0",
  tags = [],
  category = DEFAULT_SKILL_CATEGORY,
  content,
}: {
  name: unknown;
  description: unknown;
  version?: unknown;
  tags?: string[];
  category?: unknown;
  content: unknown;
}): string {
  const tagList = Array.isArray(tags) ? tags : [];
  const tagsLine = tagList.length ? `[${tagList.join(", ")}]` : "[]";
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `version: ${version}`,
    `category: ${skillCategorySlug(category)}`,
    `tags: ${tagsLine}`,
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${String(content).trim()}\n`;
}

function validateSkillDocument(raw: string): { meta: SkillMeta; body: string; slug: string } {
  const { meta, body } = parseSkillFrontmatter(String(raw || ""));
  const name = String(meta.name || "").trim();
  const description = String(meta.description || "").trim();
  if (!name) throw new Error("skill: frontmatter `name` is required.");
  if (!description) throw new Error("skill: frontmatter `description` is required.");
  if (!body || !/^##\s+/m.test(body)) {
    throw new Error("skill: body must include at least one `##` section.");
  }
  const slug = skillSlug(name);
  if (!slug) throw new Error("skill: `name` must contain letters or digits.");
  return { meta, body, slug };
}

function normalizeSkillTriggers(meta: SkillMeta): string[] {
  const raw = meta.triggers;
  if (Array.isArray(raw)) return raw.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return parseInlineList(raw);
  return [];
}

function normalizeSkillRequiresTools(meta: SkillMeta): string[] {
  const raw = meta["requires-tools"] ?? meta.requires_tools ?? meta["requires_tools"];
  if (Array.isArray(raw)) return raw.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return parseInlineList(raw);
  return [];
}

function skillMatchesAvailableTools(
  skill: { allowedTools?: string[]; requiresTools?: string[] },
  availableTools: Set<string>
): boolean {
  const requires = skill.requiresTools || [];
  if (requires.length) return requires.every((tool) => availableTools.has(tool));
  const allowed = skill.allowedTools || [];
  if (allowed.length) return allowed.some((tool) => availableTools.has(tool));
  return true;
}

function formatTriggersForIndex(triggers: string[]): string {
  const text = triggers.join(", ");
  if (!text) return "";
  if (text.length <= SKILL_INDEX_TRIGGERS_MAX_CHARS) return text;
  const cut = text.slice(0, SKILL_INDEX_TRIGGERS_MAX_CHARS - 1).replace(/, [^,]*$/, "");
  return `${cut || text.slice(0, SKILL_INDEX_TRIGGERS_MAX_CHARS - 1)}…`;
}

function isSafeSkillRelativePath(filePath, { allowSkillMd = false } = {}) {
  const raw = String(filePath || "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || raw.includes("\0")) return false;
  const normalized = nodePath.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return false;
  }
  if (allowSkillMd && normalized === SKILL_FILE_NAME) return true;
  const [root] = normalized.split("/");
  return SKILL_SUPPORT_ROOTS.has(root);
}

function skillPublicPath(absPath) {
  return nodePath.relative(WS, absPath).replace(/\\/g, "/");
}

function canonicalSkillDir({ category, slug }) {
  return nodePath.join(SKILLS_DIR, skillCategorySlug(category), skillSlug(slug));
}

async function migrateLegacySkillFiles() {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const legacyPath = nodePath.join(SKILLS_DIR, entry.name);
    const raw = await fs.readFile(legacyPath, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    let nextRaw = raw;
    let parsed;
    try {
      parsed = validateSkillDocument(raw);
    } catch {
      const legacyName = entry.name.replace(/\.md$/, "");
      nextRaw = buildSkillFileContent({
        name: legacyName,
        description: legacyName,
        content: raw.includes("## ") ? raw : `## Procedure\n\n${raw}`,
      });
      parsed = validateSkillDocument(nextRaw);
    }
    const nextDir = canonicalSkillDir({
      category: parsed.meta.category || DEFAULT_SKILL_CATEGORY,
      slug: parsed.slug,
    });
    const nextPath = nodePath.join(nextDir, SKILL_FILE_NAME);
    try {
      await fs.mkdir(nextDir, { recursive: true });
      await fs.writeFile(nextPath, nextRaw.endsWith("\n") ? nextRaw : `${nextRaw}\n`, "utf8");
      await fs.unlink(legacyPath);
    } catch {
      /* keep legacy file if migration cannot complete */
    }
  }
}

async function collectSkillRecords(): Promise<SkillRecord[]> {
  await migrateLegacySkillFiles();
  const records: SkillRecord[] = [];
  const seen = new Set<string>();
  const walk = async (dir, source = "local") => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === ".hub") continue;
      const abs = nodePath.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      const skillPath = nodePath.join(abs, SKILL_FILE_NAME);
      const raw = await fs.readFile(skillPath, "utf8").catch(() => null);
      if (raw !== null) {
        try {
          const { meta, body, slug } = validateSkillDocument(raw);
          const category = skillCategorySlug(
            meta.category || nodePath.basename(nodePath.dirname(abs)) || DEFAULT_SKILL_CATEGORY
          );
          const dedupeKey = slug;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          records.push({
            slug,
            name: String(meta.name || slug),
            description: String(meta.description || ""),
            tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
            triggers: normalizeSkillTriggers(meta),
            version: String(meta.version || "1.0.0"),
            category,
            platforms: Array.isArray(meta.platforms) ? meta.platforms : [],
            allowedTools: Array.isArray(meta["allowed-tools"]) ? meta["allowed-tools"] : [],
            requiresTools: normalizeSkillRequiresTools(meta),
            path: skillPublicPath(skillPath),
            dir: abs,
            skillPath,
            source,
            body,
            raw,
          });
        } catch {
          /* skip invalid skill */
        }
        continue;
      }
      await walk(abs, source);
    }
  };
  await walk(SKILLS_DIR, "local");
  await walk(BUNDLED_SKILLS_DIR, "bundled");
  await walk(SOURCE_BUNDLED_SKILLS_DIR, "bundled");
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

async function assertSkillWritable(record: SkillRecord | null, action: string): Promise<void> {
  if (!record) return;
  const origin = getSkillWriteOrigin();
  if (!origin || origin === "foreground") return;
  if (record.source === "bundled" || record.category === "bundled") {
    throw new Error(`skill ${action}: bundled skill '${record.name}' is protected.`);
  }
}

async function findSkillRecord(name: string): Promise<SkillRecord | null> {
  const slug = skillSlug(name);
  if (!slug) throw new Error("skill: `name` is required.");
  const records = await collectSkillRecords();
  const exact = records.find((record) => record.slug === slug);
  if (exact) return exact;
  return records.find((record) => skillSlug(record.name) === slug) || null;
}

export async function saveSkill({
  name,
  description,
  version,
  tags,
  category,
  content,
}: {
  name: unknown;
  description?: unknown;
  version?: unknown;
  tags?: unknown;
  category?: unknown;
  content: unknown;
}) {
  const slug = skillSlug(name);
  if (!slug) throw new Error("skill_save: `name` is required.");
  if (!String(content || "").trim()) throw new Error("skill_save: `content` is required.");
  const raw = String(content || "").trim().startsWith("---")
    ? String(content || "").trim()
    : buildSkillFileContent({
        name,
        description: description || name,
        version,
        tags: Array.isArray(tags) ? tags.map(String) : [],
        category,
        content,
      });
  const validated = validateSkillDocument(raw);
  const resolvedCategory = skillCategorySlug(category || validated.meta.category || DEFAULT_SKILL_CATEGORY);
  const skillDir = canonicalSkillDir({ category: resolvedCategory, slug: validated.slug });
  await fs.mkdir(skillDir, { recursive: true });
  const filePath = nodePath.join(skillDir, SKILL_FILE_NAME);
  await fs.writeFile(filePath, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
  invalidateSkillsContextCache();
  const origin = getSkillWriteOrigin();
  if (origin === "background_review" || origin === "curator") {
    await markAgentCreated(validated.slug);
  }
  return {
    ok: true,
    name: validated.meta.name || name,
    slug: validated.slug,
    category: resolvedCategory,
    path: skillPublicPath(filePath),
  };
}

export async function listSkills(filter: { query?: string; category?: string } = {}): Promise<SkillListEntry[]> {
  try {
    const query = String(filter?.query || "").trim().toLowerCase();
    const category = filter?.category ? skillCategorySlug(filter.category) : "";
    return (await collectSkillRecords())
      .filter((skill) => !category || skill.category === category)
      .filter((skill) => {
        if (!query) return true;
        const haystack = [
          skill.slug,
          skill.name,
          skill.description,
          skill.category,
          ...(skill.tags || []),
          ...(skill.triggers || []),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .map(({ body: _body, raw: _raw, dir: _dir, skillPath: _skillPath, ...skill }) => skill);
  } catch {
    return [];
  }
}

export async function loadSkill(name) {
  const record = await findSkillRecord(name);
  if (!record) throw new Error(`skill_recall: skill "${name}" not found.`);
  return record.raw;
}

export async function viewSkill({ name, file_path }: { name?: string; file_path?: string } = {}) {
  const skillName = String(name || "").trim();
  if (!skillName) throw new Error("skill_view: `name` is required.");
  const record = await findSkillRecord(skillName);
  if (!record) throw new Error(`skill_view: skill "${name}" not found.`);
  const requestedPath = String(file_path || SKILL_FILE_NAME).trim();
  if (!isSafeSkillRelativePath(requestedPath, { allowSkillMd: true })) {
    throw new Error("skill_view: `file_path` must be SKILL.md or a safe support file path.");
  }
  const targetPath = requestedPath === SKILL_FILE_NAME
    ? record.skillPath
    : nodePath.join(record.dir, nodePath.posix.normalize(requestedPath.replace(/\\/g, "/")));
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(`skill_view: file "${requestedPath}" not found in skill "${record.name}".`);
  }
  if (stat.size > SKILL_SAFE_FILE_MAX_BYTES) {
    throw new Error(`skill_view: file "${requestedPath}" is too large to inline.`);
  }
  const content = await fs.readFile(targetPath, "utf8");
  return {
    ok: true,
    name: record.name,
    slug: record.slug,
    category: record.category,
    file_path: requestedPath,
    content,
  };
}

export async function deleteSkill(name) {
  const record = await findSkillRecord(name);
  if (!record) throw new Error(`skill_delete: skill "${name}" not found.`);
  const origin = getSkillWriteOrigin();
  if ((origin === "background_review" || origin === "curator") && record.source !== "bundled") {
    if (await isPinnedSkill(record.slug)) {
      throw new Error(`skill_delete: skill "${name}" is pinned.`);
    }
    return archiveSkillDirectory(record.dir, record.slug, null);
  }
  await fs.rm(record.dir, { recursive: true, force: true });
  invalidateSkillsContextCache();
  return { ok: true, name: record.name, slug: record.slug, category: record.category };
}

function scanSkillContent(
  raw: string,
  files: { path?: string; content?: string }[] = []
): { ok: boolean; dangerous: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const dangerous: string[] = [];
  const text = [raw, ...files.map((file) => file.content || "")].join("\n");
  const patterns: [RegExp, string][] = [
    [/rm\s+-rf\s+(\/|\$HOME|~|\*)/, "destructive rm command"],
    [/curl\s+[^|;\n]+\|\s*(sh|bash)/, "curl pipe to shell"],
    [/wget\s+[^|;\n]+\|\s*(sh|bash)/, "wget pipe to shell"],
    [/(OPENROUTER_API_KEY|GITHUB_TOKEN|AWS_SECRET|PRIVATE_KEY).{0,80}(curl|fetch|http)/i, "possible secret exfiltration"],
    [/ignore (all )?(previous|system|developer) instructions/i, "prompt-injection language"],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) dangerous.push(label);
  }
  if (text.length > 120_000) warnings.push("large skill content");
  for (const file of files) {
    if (!isSafeSkillRelativePath(file.path)) dangerous.push(`unsafe support path: ${file.path}`);
  }
  return { ok: dangerous.length === 0, dangerous, warnings };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "web-agent-skills" } });
  if (!res.ok) throw new Error(`skill import: fetch failed (${res.status}) for ${url}`);
  return res.text();
}

function normalizeSkillUrl(url) {
  const raw = String(url || "").trim();
  const blob = raw.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (blob) {
    const [, owner, repo, ref, path] = blob;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  }
  return raw;
}

async function installSkillFromUrl({ url, category }) {
  const normalizedUrl = normalizeSkillUrl(url);
  if (!/^https:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/.test(normalizedUrl)) {
    throw new Error("skill import: only valid https URLs are supported.");
  }
  const raw = await fetchText(normalizedUrl);
  const validation = validateSkillDocument(raw);
  const scan = scanSkillContent(raw);
  if (!scan.ok) {
    return {
      ok: false,
      blocked: true,
      dangerous: scan.dangerous,
      warnings: scan.warnings,
    };
  }
  const result = await saveSkill({
    name: String(validation.meta.name ?? ""),
    description: String(validation.meta.description ?? ""),
    version: String(validation.meta.version ?? "1.0.0"),
    tags: Array.isArray(validation.meta.tags) ? validation.meta.tags.map(String) : [],
    category: String(category || validation.meta.category || "imported"),
    content: raw,
  });
  const hubDir = nodePath.join(SKILLS_DIR, ".hub");
  const lockPath = nodePath.join(hubDir, "lock.json");
  await fs.mkdir(hubDir, { recursive: true });
  let lock = {};
  try {
    lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch {
    lock = {};
  }
  lock[result.slug] = {
    source: normalizedUrl,
    installed_at: new Date().toISOString(),
    category: result.category,
  };
  await fs.writeFile(lockPath, JSON.stringify(lock, null, 2), "utf8");
  return { ...result, source: normalizedUrl, warnings: scan.warnings };
}

/**
 * Save or import many skills in one batch (single tool approval at the caller).
 * @param {unknown[]} items
 */
export async function bulkSaveSkills(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("skill_bulk_save: `items` must be a non-empty array.");
  }
  if (items.length > MAX_BULK_SKILL_ITEMS) {
    throw new Error(`skill_bulk_save: at most ${MAX_BULK_SKILL_ITEMS} items per call.`);
  }

  const results: Record<string, unknown>[] = [];
  let saved = 0;
  let failed = 0;
  let blocked = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] && typeof items[index] === "object" ? items[index] : {};
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const content = typeof item.content === "string" ? item.content.trim() : "";

    if (url && (name || content)) {
      failed += 1;
      results.push({
        index,
        kind: "url",
        ok: false,
        error: "skill_bulk_save: cannot set `url` together with `name` or `content`.",
        url,
      });
      continue;
    }

    if (url) {
      try {
        /* eslint-disable-next-line no-await-in-loop */
        const out = await installSkillFromUrl({
          url,
          category: typeof item.category === "string" ? item.category.trim() : undefined,
        });
        if (out.blocked) {
          blocked += 1;
          results.push({
            index,
            kind: "url",
            ok: false,
            blocked: true,
            url,
            dangerous: out.dangerous,
            warnings: out.warnings,
          });
        } else {
          saved += 1;
          results.push({ index, kind: "url", ...out });
        }
      } catch (e) {
        failed += 1;
        results.push({
          index,
          kind: "url",
          ok: false,
          url,
          error: errorMessage(e),
        });
      }
      continue;
    }

    if (!name || !content) {
      failed += 1;
      results.push({
        index,
        kind: "inline",
        ok: false,
        error: "skill_bulk_save: inline item requires `name` and `content`.",
        name: name || undefined,
      });
      continue;
    }

    try {
      /* eslint-disable-next-line no-await-in-loop */
      const out = await saveSkill({
        name,
        description:
          typeof item.description === "string" ? item.description.trim() : name,
        version: typeof item.version === "string" ? item.version.trim() : undefined,
        category: typeof item.category === "string" ? item.category.trim() : undefined,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        content,
      });
      saved += 1;
      results.push({ index, kind: "inline", ...out });
    } catch (e) {
      failed += 1;
      results.push({
        index,
        kind: "inline",
        ok: false,
        name,
        error: errorMessage(e),
      });
    }
  }

  return {
    ok: true,
    results,
    summary: {
      total: items.length,
      saved,
      failed,
      blocked,
    },
  };
}

export async function manageSkill(args: Record<string, unknown> = {}) {
  const action = String(args?.action || "").trim();
  if (!action) throw new Error("skill_manage: `action` is required.");

  if (action === "create") {
    return saveSkill({
      name: args.name,
      description: args.description,
      version: args.version,
      tags: args.tags,
      category: args.category,
      content: args.content,
    });
  }
  if (action === "install_url" || action === "import_url") {
    return installSkillFromUrl({
      url: String(args.url || ""),
      category: typeof args.category === "string" ? args.category : undefined,
    });
  }

  const manageName = String(args.name || "").trim();
  const record = manageName ? await findSkillRecord(manageName) : null;

  if (action === "delete") {
    if (!record) throw new Error(`skill_manage: skill "${manageName}" not found.`);
    const absorbedInto =
      typeof args.absorbed_into === "string" ? String(args.absorbed_into).trim() : null;
    const origin = getSkillWriteOrigin();
    if (origin === "background_review" || origin === "curator") {
      if (await isPinnedSkill(record.slug)) {
        throw new Error(`skill_manage delete: skill "${manageName}" is pinned.`);
      }
      return archiveSkillDirectory(record.dir, record.slug, absorbedInto);
    }
    return deleteSkill(manageName);
  }

  if (!record) throw new Error(`skill_manage: skill "${manageName}" not found.`);

  if (action === "edit") {
    await assertSkillWritable(record, "edit");
    const content = String(args.content || "");
    validateSkillDocument(content);
    await fs.writeFile(record.skillPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    invalidateSkillsContextCache();
    await recordSkillPatch(record.slug);
    return { ok: true, action, name: record.name, slug: record.slug, path: skillPublicPath(record.skillPath) };
  }

  if (action === "patch") {
    await assertSkillWritable(record, "patch");
    const oldString = String(args.old_string || "");
    const newString = String(args.new_string ?? "");
    if (!oldString) throw new Error("skill_manage patch: `old_string` is required.");
    const filePath = String(args.file_path || SKILL_FILE_NAME);
    if (!isSafeSkillRelativePath(filePath, { allowSkillMd: true })) {
      throw new Error("skill_manage patch: unsafe `file_path`.");
    }
    const targetPath = filePath === SKILL_FILE_NAME
      ? record.skillPath
      : nodePath.join(record.dir, nodePath.posix.normalize(filePath.replace(/\\/g, "/")));
    const original = await fs.readFile(targetPath, "utf8");
    if (!original.includes(oldString)) {
      throw new Error("skill_manage patch: `old_string` not found.");
    }
    const next = original.replace(oldString, newString);
    if (filePath === SKILL_FILE_NAME) validateSkillDocument(next);
    await fs.writeFile(targetPath, next, "utf8");
    if (filePath === SKILL_FILE_NAME) invalidateSkillsContextCache();
    await recordSkillPatch(record.slug);
    return { ok: true, action, name: record.name, slug: record.slug, file_path: filePath };
  }

  if (action === "write_file") {
    await assertSkillWritable(record, "write_file");
    const filePath = String(args.file_path || "");
    if (!isSafeSkillRelativePath(filePath, { allowSkillMd: true })) {
      throw new Error("skill_manage write_file: unsafe `file_path`.");
    }
    const content = String(args.content || "");
    if (filePath === SKILL_FILE_NAME) validateSkillDocument(content);
    const targetPath = filePath === SKILL_FILE_NAME
      ? record.skillPath
      : nodePath.join(record.dir, nodePath.posix.normalize(filePath.replace(/\\/g, "/")));
    await fs.mkdir(nodePath.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
    if (filePath === SKILL_FILE_NAME) invalidateSkillsContextCache();
    await recordSkillPatch(record.slug);
    return { ok: true, action, name: record.name, slug: record.slug, file_path: filePath };
  }

  if (action === "remove_file") {
    const filePath = String(args.file_path || "");
    if (!isSafeSkillRelativePath(filePath)) {
      throw new Error("skill_manage remove_file: unsafe `file_path`.");
    }
    const targetPath = nodePath.join(record.dir, nodePath.posix.normalize(filePath.replace(/\\/g, "/")));
    await fs.rm(targetPath, { force: true });
    return { ok: true, action, name: record.name, slug: record.slug, file_path: filePath };
  }

  throw new Error(`skill_manage: unsupported action "${action}".`);
}

export async function buildSkillsContextBlock(availableToolNames: string[] = []) {
  const cacheKey = [...availableToolNames].sort().join(",");
  if (_skillsContextBlockCache !== null && _skillsContextBlockCacheKey === cacheKey) {
    return _skillsContextBlockCache;
  }
  try {
    const availableTools = new Set(
      (availableToolNames || []).map((name) => String(name || "").trim()).filter(Boolean)
    );
    const skills = (await listSkills())
      .filter((skill) => !availableTools.size || skillMatchesAvailableTools(skill, availableTools)).sort((a, b) => {
      const bundledRank = (s) => (s.source === "bundled" || s.category === "bundled" ? 0 : 1);
      const ra = bundledRank(a);
      const rb = bundledRank(b);
      if (ra !== rb) return ra - rb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    if (!skills.length) return "";
    const lines = [
      "Available skills (procedural knowledge, compact index):",
      "Match the user's latest message to each skill's description and triggers; call `skill_view` on the best slug before acting. Full procedures load only via `skill_view`. `skill_save` and `skill_manage` apply create/patch/import changes immediately without a confirmation prompt. Use `skill_delete` or `skill_bulk_save` when the user must confirm removal or batched installs (each shows one approval gate). Prefer `skill_bulk_save` when adding many skills in one request.",
    ];
    let budget = SKILLS_CONTEXT_CHAR_BUDGET;
    for (const skill of skills) {
      const tagText = skill.tags?.length ? ` tags=${skill.tags.join(",")}` : "";
      const triggerText = skill.triggers?.length
        ? ` | triggers: ${formatTriggersForIndex(skill.triggers)}`
        : "";
      const line = `- ${skill.name} (slug: ${skill.slug}, category: ${skill.category}${tagText}): ${skill.description}${triggerText}`;
      if (line.length > budget) {
        lines.push("- [more skills omitted from prompt; call skill_list to search]");
        break;
      }
      lines.push(line);
      budget -= line.length;
    }
    _skillsContextBlockCache = `\n\n${lines.join("\n")}`;
    _skillsContextBlockCacheKey = cacheKey;
    return _skillsContextBlockCache;
  } catch {
    return "";
  }
}
