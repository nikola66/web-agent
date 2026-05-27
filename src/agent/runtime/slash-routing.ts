import { listSkills } from "./memory/index.js";
import { resolveFindSkillsUserMessage } from "./find-skills-slash.js";
import { buildPlanModeUserPrompt } from "./planning-slash.js";
import { rewriteWikiSlashUserMessage } from "./wiki-slash.js";

export const TELEGRAM_COMMAND_RE = /^[a-z0-9_]{1,32}$/;

/** Built-in slash tokens (underscore form). Skill slugs that collide use these commands instead. */
export const RESERVED_SLASH_TOKENS = new Set([
  "help",
  "clear",
  "compact",
  "plan",
  "find_skills",
  "checkpoint",
  "rollback",
  "skills",
  "stop",
  "wiki_setup",
  "wiki_sync",
  "wiki_search",
]);

export function commandSlug(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Telegram menu command for a skill slug (underscores only). Returns null when a built-in owns the token. */
export function skillSlugToTelegramCommand(slug: string): string | null {
  const cmd = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!cmd || RESERVED_SLASH_TOKENS.has(cmd) || !TELEGRAM_COMMAND_RE.test(cmd)) return null;
  return cmd;
}

export function slashTokenToSkillSlug(token: string): string {
  return String(token || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

export function skillSlashCommandForSurface(
  slug: string,
  surface: "terminal" | "telegram"
): string {
  const normalized = String(slug || "").trim();
  if (!normalized) return "/";
  if (surface === "telegram") {
    const tg = skillSlugToTelegramCommand(normalized);
    return tg ? `/${tg}` : `/${normalized.replace(/-/g, "_")}`;
  }
  return `/${normalized}`;
}

type SkillListEntry = Awaited<ReturnType<typeof listSkills>>[number];

export function findSkillBySlashToken(
  token: string,
  skills: SkillListEntry[]
): SkillListEntry | null {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized || RESERVED_SLASH_TOKENS.has(normalized)) return null;
  const hyphen = slashTokenToSkillSlug(normalized);
  return (
    skills.find(
      (item) =>
        item.slug === normalized ||
        item.slug === hyphen ||
        commandSlug(item.name) === normalized ||
        commandSlug(item.name) === hyphen
    ) ?? null
  );
}

export function buildSkillInvocationUserMessage(skill: SkillListEntry, task: string): string {
  return [
    `The user invoked the installed skill "${skill.name}" (slug: ${skill.slug}).`,
    `First call skill_view with {"name":"${skill.slug}"} to load the full SKILL.md, then use it for this task.`,
    task
      ? `Task: ${task}`
      : "Task: Use this skill for the next appropriate workflow and ask one concise clarifying question only if required.",
  ].join("\n");
}

/** Rewrite slash input into the synthetic user message the agent loop expects (or return null to keep raw text). */
export async function resolveSlashUserMessage(input: string): Promise<string | null> {
  const trimmed = normalizeSlashCommandInput(input);
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;

  const wikiRewrite = rewriteWikiSlashUserMessage(trimmed);
  if (wikiRewrite !== null) return wikiRewrite;

  const findSkillsRewrite = resolveFindSkillsUserMessage(trimmed);
  if (findSkillsRewrite !== null) return findSkillsRewrite;

  if (trimmed === "/plan" || trimmed.startsWith("/plan ")) {
    const goal = trimmed === "/plan" ? "" : trimmed.slice("/plan ".length).trim();
    return buildPlanModeUserPrompt(goal);
  }

  const token = trimmed.split(/\s+/)[0].slice(1);
  const skills = await listSkills();
  const skill = findSkillBySlashToken(token, skills);
  if (!skill) return null;

  const task = trimmed.slice(token.length + 1).trim();
  return buildSkillInvocationUserMessage(skill, task);
}

export type LocalSlashKind =
  | "none"
  | "clear"
  | "checkpoint"
  | "rollback"
  | "help"
  | "skills"
  | "compact"
  | "stop";

export type LocalSlashCommand =
  | { kind: "none" }
  | { kind: "clear" }
  | { kind: "checkpoint"; name: string }
  | { kind: "rollback"; name: string }
  | { kind: "help" }
  | { kind: "skills"; input: string }
  | { kind: "compact" }
  | { kind: "stop" };

/** Strip Telegram `@botname` suffix (e.g. `/help@bot`). */
export function normalizeSlashCommandInput(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(/^\/([a-z0-9_-]+)@[\w]+/i, "/$1");
}

export function parseLocalSlashCommand(trimmed: string): LocalSlashCommand {
  const input = normalizeSlashCommandInput(trimmed);
  if (!input.startsWith("/")) return { kind: "none" };

  if (input === "/clear") return { kind: "clear" };
  if (input === "/help") return { kind: "help" };
  if (input === "/compact") return { kind: "compact" };
  if (input === "/stop") return { kind: "stop" };
  if (input === "/skills" || input.startsWith("/skills ")) return { kind: "skills", input };
  if (input.startsWith("/checkpoint")) {
    return {
      kind: "checkpoint",
      name: input.slice("/checkpoint".length).trim() || `ckpt_${Date.now()}`,
    };
  }
  if (input.startsWith("/rollback")) {
    return { kind: "rollback", name: input.slice("/rollback".length).trim() };
  }
  return { kind: "none" };
}
