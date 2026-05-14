import * as memoryServices from "./memory/index.js";
import type { SlashCommandRow, ToolViewRow, SkillViewRow } from "./slash-command-views.js";
import { renderHelpView, renderSkillsView } from "./slash-command-views.js";
import { dim, red } from "./terminal-format.js";

export type OutboundSurface = "terminal" | "telegram";

/** Map inbound channel id to formatting surface; extend when adding channels. */
export function outboundSurfaceForChannel(channel: string): OutboundSurface {
  return String(channel || "").trim() === "telegram" ? "telegram" : "telegram";
}

const TG = {
  helpSlash: "⌨️ **Slash commands**",
  helpTools: "🛠 **Tools**",
  helpFooter: "Invoke a skill with `/<skill-slug>` + optional task. List skills: `/skills`.",
  skillsTitle: "📚 **Installed skills**",
  skillsFooter: "Invoke with `/<skill-slug>` + optional task. Filter: `/skills search <query>`.",
} as const;

const DESCRIPTION_DISPLAY_MAX = 160;

function tgTrim(value: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  if (text.length <= DESCRIPTION_DISPLAY_MAX) return text;
  return `${text.slice(0, DESCRIPTION_DISPLAY_MAX - 1).trimEnd()}…`;
}

function normalizeToolEmoji(emoji: string) {
  return String(emoji || "").replace(/([\p{Extended_Pictographic}])\s+(\uFE0F)/gu, "$1$2");
}

export function formatHelpForSurface(
  surface: OutboundSurface,
  commands: SlashCommandRow[],
  toolRows: ToolViewRow[]
): string {
  if (surface === "terminal") return renderHelpView(commands, toolRows);
  const lines: string[] = [TG.helpSlash, ""];
  for (const command of commands) {
    const name = String(command.name || "").trim();
    const desc = tgTrim(String(command.description || ""));
    lines.push(`- \`${name}\` — ${desc}`);
  }
  lines.push("", "---", "", TG.helpTools, "");
  for (const tool of toolRows) {
    const em = normalizeToolEmoji(tool.emoji || "").trim() || "·";
    lines.push(`- ${em} \`${tool.name}\` — ${tgTrim(tool.description)}`);
  }
  lines.push("", TG.helpFooter);
  return lines.join("\n");
}

function skillDisplayName(skill: SkillViewRow) {
  const name = String(skill.name || "").trim();
  const slug = String(skill.slug || "").trim();
  if (!name || name === slug) return "";
  return name;
}

function skillTagsLine(skill: SkillViewRow) {
  const values = Array.isArray(skill.tags)
    ? skill.tags.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  return values.length ? values.join(", ") : "";
}

export function formatSkillsForSurface(
  surface: OutboundSurface,
  skills: SkillViewRow[],
  options: { query?: string } = {}
): string {
  if (surface === "terminal") return renderSkillsView(skills, options);
  const query = String(options.query || "").trim();
  const lines: string[] = [TG.skillsTitle];
  if (query) lines.push("", `_filtered: ${query}_`);
  if (!skills.length) {
    lines.push(
      "",
      query
        ? `No skills matched **${query}**. Try \`/skills search <query>\` or \`/skills install <url>\`.`
        : "No skills installed yet. Use `/skills install <https-url-to-SKILL.md>`."
    );
    return lines.join("\n");
  }
  const grouped = new Map<string, SkillViewRow[]>();
  for (const skill of skills) {
    const category = String(skill.category || "local").trim() || "local";
    const bucket = grouped.get(category) || [];
    bucket.push(skill);
    grouped.set(category, bucket);
  }
  const categories = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  for (const category of categories) {
    const rows = (grouped.get(category) || []).slice().sort((a, b) => {
      const left = String(a.name || a.slug || "");
      const right = String(b.name || b.slug || "");
      return left.localeCompare(right);
    });
    lines.push("", `**${category}**`);
    for (const skill of rows) {
      const slug = `/${String(skill.slug || "").trim()}`;
      const nm = skillDisplayName(skill);
      const desc = tgTrim(String(skill.description || skill.name || ""));
      const tags = skillTagsLine(skill);
      const head = nm ? `\`${slug}\` **${nm}**` : `\`${slug}\``;
      const tail = tags ? `${desc} · _${tags}_` : desc;
      lines.push(`- ${head} — ${tail}`);
    }
  }
  lines.push("", TG.skillsFooter);
  return lines.join("\n");
}

async function printSkillsSurface(
  surface: OutboundSurface,
  query: string,
  emit: (msg: string) => void | Promise<void>
) {
  const skills = await memoryServices.listSkills({ query });
  await emit(formatSkillsForSurface(surface, skills, { query }));
}

/**
 * Local /skills handling (list, search, install) shared by REPL and channel dispatcher.
 */
export async function runSkillsSlashCommand(
  input: string,
  surface: OutboundSurface,
  emit: (msg: string) => void | Promise<void>
): Promise<boolean> {
  const rest = input.slice("/skills".length).trim();
  const styleErr = (s: string) => (surface === "terminal" ? red(s) : `⚠️ ${s}`);
  const styleOk = (s: string) => (surface === "terminal" ? dim(s) : `✓ ${s}`);

  if (!rest || rest.startsWith("search ")) {
    const q = rest.startsWith("search ") ? rest.slice("search ".length).trim() : "";
    await printSkillsSurface(surface, q, emit);
    return true;
  }
  if (rest.startsWith("install ") || rest.startsWith("import ")) {
    const url = rest.replace(/^(install|import)\s+/, "").trim();
    if (!url) {
      await emit(styleErr("Usage: /skills install <https-url-to-SKILL.md>\n"));
      return true;
    }
    const result = await memoryServices.manageSkill({ action: "install_url", url });
    if (result?.blocked) {
      await emit(
        styleErr(`Skill import blocked: ${(result.dangerous || []).join(", ")}\n`)
      );
    } else {
      await emit(
        styleOk(`Installed skill /${result.slug} from ${result.source || url}\n`)
      );
    }
    return true;
  }
  await printSkillsSurface(surface, rest, emit);
  return true;
}
