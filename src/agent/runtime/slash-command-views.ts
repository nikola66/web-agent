import {
  bold,
  cyan,
  dim,
  renderMarkdownToAnsi,
  renderTerminalNote,
  renderTerminalTable,
  amber,
} from "./terminal-format.js";

export type SlashCommandRow = {
  name: string;
  description: string;
};

export type ToolViewRow = {
  emoji?: string;
  name: string;
  description: string;
};

export type SkillViewRow = {
  slug: string;
  name?: string;
  description?: string;
  tags?: string[];
  category?: string;
};

const DESCRIPTION_DISPLAY_MAX = 160;

function escapeTableCell(value: string) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function trimDescription(value: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  if (text.length <= DESCRIPTION_DISPLAY_MAX) return text;
  return `${text.slice(0, DESCRIPTION_DISPLAY_MAX - 1).trimEnd()}…`;
}

function normalizeToolEmoji(emoji: string) {
  return String(emoji || "").replace(
    /([\p{Extended_Pictographic}])\s+(\uFE0F)/gu,
    "$1$2"
  );
}

export function buildToolRowsFromCatalog(
  catalog: Record<string, { emoji?: string; description?: string } | undefined>
): ToolViewRow[] {
  return Object.keys(catalog || {})
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const meta = catalog[name];
      return {
        emoji: normalizeToolEmoji(meta?.emoji || ""),
        name,
        description: String(meta?.description || "").trim() || "see tool schema in system instructions",
      };
    });
}

export function buildHelpMarkdown(commands: SlashCommandRow[], toolRows: ToolViewRow[]) {
  const lines: string[] = [
    "## ⌨️ Slash commands",
    "",
    "| Command | What it does |",
    "| --- | --- |",
  ];

  for (const command of commands) {
    const commandName = escapeTableCell(String(command.name || ""));
    const description = escapeTableCell(String(command.description || ""));
    lines.push(`| \`${commandName}\` | ${description} |`);
  }

  lines.push("", "---", "", "## 🛠️ Tools", "", "| | Tool | Description |", "| --- | --- | --- |");

  for (const tool of toolRows) {
    const emoji = escapeTableCell(normalizeToolEmoji(tool.emoji || ""));
    const name = escapeTableCell(tool.name);
    const description = escapeTableCell(trimDescription(tool.description));
    lines.push(`| ${emoji} | \`${name}\` | ${description} |`);
  }

  lines.push(
    "",
    "> Invoke a skill with `/<skill-slug> [task]`. List skills with `/skills`.",
    "",
    ""
  );

  return lines.join("\n\n");
}

function formatSkillName(skill: SkillViewRow) {
  const name = String(skill.name || "").trim();
  const slug = String(skill.slug || "").trim();
  if (!name || name === slug) return "—";
  return escapeTableCell(name);
}

function formatSkillTags(tags: string[] | undefined) {
  const values = Array.isArray(tags) ? tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
  return values.length ? escapeTableCell(values.join(", ")) : "—";
}

export function buildSkillsMarkdown(skills: SkillViewRow[], options: { query?: string } = {}) {
  const query = String(options.query || "").trim();
  const lines: string[] = ["## 📚 Installed skills"];

  if (query) {
    lines.push("", `_(filtered: "${escapeTableCell(query)}")_`);
  }

  if (!skills.length) {
    lines.push(
      "",
      query
        ? `No skills matched **${escapeTableCell(query)}**. Try \`/skills search <query>\` or install with \`/skills install <url>\`.`
        : "No skills installed yet. Install with `/skills install <https-url-to-SKILL.md>` or save skills from the agent."
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

    lines.push("", `### ${escapeTableCell(category)}`, "", "| Skill | Name | Description | Tags |", "| --- | --- | --- | --- |");
    for (const skill of rows) {
      const slug = escapeTableCell(`/${String(skill.slug || "").trim()}`);
      const name = formatSkillName(skill);
      const description = escapeTableCell(trimDescription(String(skill.description || skill.name || "")));
      const tags = formatSkillTags(skill.tags);
      lines.push(`| \`${slug}\` | ${name} | ${description} | ${tags} |`);
    }
  }

  lines.push("", "> Invoke with `/<skill-slug> [task]`. Filter with `/skills search <query>`.");
  return lines.join("\n");
}

export function renderHelpView(commands: SlashCommandRow[], toolRows: ToolViewRow[]) {
  const sections: string[] = [
    cyan(bold("⌨️ Slash commands")),
    "",
    renderTerminalTable(
      [
        { label: "Command", minWidth: 10, maxWidth: 20, wrap: false, formatter: (text) => amber(text) },
        { label: "What it does", minWidth: 24, maxWidth: 72, wrap: true },
      ],
      commands.map((command) => [
        String(command.name || "").trim(),
        String(command.description || "").trim(),
      ])
    ),
    "",
    cyan(bold("🛠️ Tools")),
    "",
    renderTerminalTable(
      [
        { label: "", minWidth: 2, maxWidth: 3, wrap: false },
        { label: "Tool", minWidth: 12, maxWidth: 20, wrap: false, formatter: (text) => amber(text) },
        { label: "Description", minWidth: 24, maxWidth: 72, wrap: true },
      ],
      toolRows.map((tool) => [
        normalizeToolEmoji(tool.emoji || "") || "·",
        tool.name,
        trimDescription(tool.description),
      ])
    ),
    "",
    renderTerminalNote("Invoke a skill with `/<skill-slug> [task]`. List skills with `/skills`."),
  ];
  return `${sections.join("\n\n")}`;
}

export function renderSkillsView(skills: SkillViewRow[], options: { query?: string } = {}) {
  const query = String(options.query || "").trim();
  const sections: string[] = [cyan(bold("📚 Installed skills"))];

  if (query) sections.push("", dim(`filtered: "${query}"`));

  if (!skills.length) {
    sections.push(
      "",
      renderMarkdownToAnsi(
        query
          ? `No skills matched **${escapeTableCell(query)}**. Try \`/skills search <query>\` or install with \`/skills install <url>\`.`
          : "No skills installed yet. Install with `/skills install <https-url-to-SKILL.md>` or save skills from the agent."
      )
    );
    return `${sections.join("\n")}\n`;
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

    sections.push(
      "",
      bold(category),
      "",
      renderTerminalTable(
        [
          { label: "Skill", minWidth: 10, maxWidth: 20, wrap: false, formatter: (text) => amber(text) },
          { label: "Name", minWidth: 10, maxWidth: 18, wrap: true },
          { label: "Description", minWidth: 22, maxWidth: 54, wrap: true },
          { label: "Tags", minWidth: 8, maxWidth: 24, wrap: true },
        ],
        rows.map((skill) => [
          `/${String(skill.slug || "").trim()}`,
          formatSkillName(skill),
          trimDescription(String(skill.description || skill.name || "")),
          formatSkillTags(skill.tags),
        ])
      )
    );
  }

  sections.push(
    "",
    renderTerminalNote("Invoke with `/<skill-slug> [task]`. Filter with `/skills search <query>`.")
  );
  return `${sections.join("\n")}\n`;
}
