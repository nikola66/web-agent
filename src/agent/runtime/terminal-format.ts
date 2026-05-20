import { ROOT } from "./constants.js";
import { SLASH_COMMANDS } from "./commands.js";
import { stripAnsi } from "./utils.js";

export const R = "\x1b[0m";

export const dim = (s: string) => `\x1b[90m${s}${R}`;
export const grey = (s: string) => `\x1b[38;2;180;180;180m${s}${R}`;
export const pink = (s: string) => `\x1b[38;2;251;117;252m${s}${R}`;
export const green = (s: string) => `\x1b[32m${s}${R}`;
export const red = (s: string) => `\x1b[31m${s}${R}`;
export const cyan = (s: string) => `\x1b[36m${s}${R}`;
export const violet = (s: string) => `\x1b[38;2;138;56;245m${s}${R}`;
export const amber = (s: string) => `\x1b[38;2;251;191;36m${s}${R}`;
export const blue = (s: string) => `\x1b[38;2;96;165;250m${s}${R}`;
export const bold = (s: string) => `\x1b[1m${s}${R}`;
export const italic = (s: string) => `\x1b[3m${s}${R}`;

export type TerminalTableColumn = {
  label: string;
  minWidth?: number;
  maxWidth?: number;
  wrap?: boolean;
  formatter?: (text: string) => string;
};

/**
 * When `process.stdout.columns` is unset (piped/non-TTY), assume a typical width
 * so banners, padding, and markdown rules still lay out sensibly.
 */
const TERMINAL_COLUMNS_FALLBACK = 120;

/**
 * PTY column count for full-width rows (same idea as xterm.js `Terminal.cols`).
 * Uses the larger of `stdout.columns` and `COLUMNS`: WebContainer/Nodebox often reports
 * a default width on stdout (e.g. 80) while the host sets `COLUMNS` from the real xterm
 * `fit()` size at spawn. PTY width does not update after resize until the runtime supports it.
 */
export function terminalColumnCount(): number {
  const runtimeProcess = typeof process !== "undefined" ? process : undefined;
  const fromStdout = Number(runtimeProcess?.stdout?.columns);
  const fromEnv = Number(runtimeProcess?.env?.COLUMNS);
  const s = Number.isFinite(fromStdout) && fromStdout > 0 ? Math.floor(fromStdout) : 0;
  const e = Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : 0;
  const w = Math.max(s, e);
  if (w > 0) return w;
  return TERMINAL_COLUMNS_FALLBACK;
}

const BLOCK_FONT = {
  A: [" ██  ", "█  █ ", "████ ", "█  █ ", "█  █ "],
  B: ["███  ", "█  █ ", "███  ", "█  █ ", "███  "],
  C: [" ███ ", "█    ", "█    ", "█    ", " ███ "],
  D: ["███  ", "█  █ ", "█  █ ", "█  █ ", "███  "],
  E: ["████ ", "█    ", "███  ", "█    ", "████ "],
  F: ["████ ", "█    ", "███  ", "█    ", "█    "],
  G: [" ███ ", "█    ", "█ ██ ", "█  █ ", " ███ "],
  H: ["█  █ ", "█  █ ", "████ ", "█  █ ", "█  █ "],
  I: ["███  ", " █   ", " █   ", " █   ", "███  "],
  J: ["  ██ ", "   █ ", "   █ ", "█  █ ", " ██  "],
  K: ["█  █ ", "█ █  ", "██   ", "█ █  ", "█  █ "],
  L: ["█    ", "█    ", "█    ", "█    ", "████ "],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  O: [" ██  ", "█  █ ", "█  █ ", "█  █ ", " ██  "],
  P: ["███  ", "█  █ ", "███  ", "█    ", "█    "],
  Q: [" ██  ", "█  █ ", "█  █ ", "█ ██ ", " ███ "],
  R: ["███  ", "█  █ ", "███  ", "█ █  ", "█  █ "],
  S: [" ███ ", "█    ", " ██  ", "   █ ", "███  "],
  T: ["████ ", " █   ", " █   ", " █   ", " █   "],
  U: ["█  █ ", "█  █ ", "█  █ ", "█  █ ", " ██  "],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
  X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
  Z: ["████ ", "  █  ", " █   ", "█    ", "████ "],
  0: [" ██  ", "█  █ ", "█  █ ", "█  █ ", " ██  "],
  1: [" ██  ", "  █  ", "  █  ", "  █  ", " ███ "],
  2: ["███  ", "   █ ", " ██  ", "█    ", "████ "],
  3: ["███  ", "   █ ", " ██  ", "   █ ", "███  "],
  4: ["█  █ ", "█  █ ", "████ ", "   █ ", "   █ "],
  5: ["████ ", "█    ", "███  ", "   █ ", "███  "],
  6: [" ██  ", "█    ", "███  ", "█  █ ", " ██  "],
  7: ["████ ", "   █ ", "  █  ", " █   ", "█    "],
  8: [" ██  ", "█  █ ", " ██  ", "█  █ ", " ██  "],
  9: [" ██  ", "█  █ ", " ███ ", "   █ ", " ██  "],
};

type BlockFontKey = keyof typeof BLOCK_FONT;

export function normalizeEmojiSpacing(input: unknown) {
  if (!input) return "";
  return String(input).replace(
    /([\p{Extended_Pictographic}])\s+(\uFE0F)/gu,
    "$1$2"
  );
}

export function styleInlineMarkdown(input: unknown) {
  if (!input) return "";
  let out = normalizeEmojiSpacing(input);
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => amber(code));
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (_m, text) => bold(text));
  out = out.replace(/(^|[^\w])__([^_\n]+)__([^\w]|$)/g, (_m, pre, text, post) => `${pre}${bold(text)}${post}`);
  out = out.replace(/(^|[^\*])\*([^*\n]+)\*/g, (_m, pre, text) => `${pre}${italic(text)}`);
  out = out.replace(/(^|[^\w])_([^_\n]+)_([^\w]|$)/g, (_m, pre, text, post) => `${pre}${italic(text)}${post}`);
  return out;
}

/** GFM-ish table row: optional indent, pipe-delimited cells, optional trailing `|`. */
function splitTableRow(line: string | undefined) {
  const t = String(line || "").replace(/^\s+/, "").replace(/\s+$/, "");
  if (!t.startsWith("|")) return null;
  const inner = t.endsWith("|") ? t.slice(1, -1) : t.slice(1);
  const cells = inner.split("|").map((c) => c.trim());
  return cells.length ? cells : null;
}

/** Alignment row `| --- | :---: | ---: |`. */
function isSeparatorRow(cells: string[]) {
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function padRow(cells: string[], n: number) {
  const row = cells.slice(0, n);
  while (row.length < n) row.push("");
  return row;
}

/** @returns {{ header: string[]; body: string[][]; nextIdx: number } | null} */
function tryConsumeGfmTable(lines: string[], startIdx: number) {
  if (startIdx >= lines.length) return null;
  const hdr = splitTableRow(lines[startIdx]);
  if (!hdr || hdr.length < 2) return null;
  if (startIdx + 1 >= lines.length) return null;
  const sep = splitTableRow(lines[startIdx + 1]);
  if (!sep || sep.length !== hdr.length || !isSeparatorRow(sep)) return null;

  let j = startIdx + 2;
  const body: string[][] = [];
  while (j < lines.length) {
    const raw = lines[j];
    if (!String(raw ?? "").trim()) break;
    const row = splitTableRow(raw);
    if (!row) break;
    body.push(row);
    j++;
  }

  const n = hdr.length;
  return {
    header: [...hdr],
    body: body.map((r) => padRow(r, n)),
    nextIdx: j,
  };
}

function graphemes(text: string) {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
      .map((segment) => segment.segment);
  } catch {
    return [...text];
  }
}

function codepointCellWidth(codepoint: number) {
  if (codepoint === 0 || codepoint < 32 || (codepoint >= 0x7f && codepoint < 0xa0)) return 0;
  if (
    (codepoint >= 0x0300 && codepoint <= 0x036f) ||
    (codepoint >= 0xfe00 && codepoint <= 0xfe0f) ||
    codepoint === 0x200d
  ) return 0;
  if (
    (codepoint >= 0x1100 && codepoint <= 0x115f) ||
    (codepoint >= 0x2e80 && codepoint <= 0xa4cf) ||
    (codepoint >= 0xac00 && codepoint <= 0xd7a3) ||
    (codepoint >= 0xf900 && codepoint <= 0xfaff) ||
    (codepoint >= 0xfe10 && codepoint <= 0xfe19) ||
    (codepoint >= 0xfe30 && codepoint <= 0xfe6f) ||
    (codepoint >= 0xff00 && codepoint <= 0xff60) ||
    (codepoint >= 0xffe0 && codepoint <= 0xffe6)
  ) return 2;
  return 1;
}

function displayWidth(text: string) {
  let width = 0;
  for (const cluster of graphemes(text)) {
    if (/\p{Extended_Pictographic}/u.test(cluster)) {
      width += 2;
      continue;
    }
    for (const char of cluster) {
      width += codepointCellWidth(char.codePointAt(0) ?? 0);
    }
  }
  return width;
}

function ansiDisplayWidth(text: string) {
  return displayWidth(stripAnsi(text));
}

function padCell(content: string, width: number) {
  const w = ansiDisplayWidth(content);
  const pad = width - w;
  return content + (pad > 0 ? " ".repeat(pad) : "");
}

function cellTextWidth(content: string) {
  return ansiDisplayWidth(styleInlineMarkdown(content));
}

function wrapPlainText(text: string, width: number) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  if (width <= 1) return graphemes(clean);
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  const pushChunkedWord = (word: string) => {
    let rest = "";
    for (const ch of graphemes(word)) {
      if (rest && displayWidth(rest + ch) > width) {
        lines.push(rest);
        rest = "";
      }
      rest += ch;
    }
    current = rest;
  };

  for (const word of words) {
    if (!word) continue;
    if (!current) {
      if (displayWidth(word) <= width) current = word;
      else pushChunkedWord(word);
      continue;
    }
    const next = `${current} ${word}`;
    if (displayWidth(next) <= width) {
      current = next;
      continue;
    }
    lines.push(current);
    if (displayWidth(word) <= width) current = word;
    else pushChunkedWord(word);
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function resolveTableColumnWidths(
  columns: TerminalTableColumn[],
  rows: string[][],
  maxTableWidth: number
) {
  const safeColumns = columns.length ? columns : [{ label: "" }];
  const widths = safeColumns.map((column, index) => {
    const values = [
      cellTextWidth(column.label),
      ...rows.map((row) => cellTextWidth(String(row[index] || ""))),
    ];
    const intrinsic = Math.max(...values, 1);
    const minWidth = Math.max(1, Math.min(column.minWidth ?? intrinsic, intrinsic));
    const maxWidth = Math.max(minWidth, column.maxWidth ?? intrinsic);
    return Math.min(Math.max(intrinsic, minWidth), maxWidth);
  });

  const tableWidth = () => widths.reduce((sum, width) => sum + width, 0) + 3 * safeColumns.length + 1;
  const shrinkCandidates = () =>
    safeColumns
      .map((column, index) => ({
        index,
        wrap: column.wrap !== false,
        minWidth: Math.max(1, Math.min(column.minWidth ?? widths[index], widths[index])),
      }))
      .sort((a, b) => widths[b.index] - widths[a.index]);

  while (tableWidth() > maxTableWidth) {
    const candidate = shrinkCandidates().find((entry) => entry.wrap && widths[entry.index] > entry.minWidth)
      || shrinkCandidates().find((entry) => widths[entry.index] > entry.minWidth);
    if (!candidate) break;
    widths[candidate.index] -= 1;
  }

  while (tableWidth() > maxTableWidth) {
    const candidate = safeColumns
      .map((_, index) => index)
      .sort((a, b) => widths[b] - widths[a])
      .find((index) => widths[index] > 1);
    if (candidate === undefined) break;
    widths[candidate] -= 1;
  }

  return widths;
}

function renderWrappedTableRows(
  row: string[],
  widths: number[],
  styleCell: (text: string, columnIndex: number) => string = (text) => styleInlineMarkdown(text)
) {
  const wrapped = row.map((cell, index) => {
    const raw = String(cell || "");
    return wrapPlainText(raw, widths[index]).map((line) => styleCell(line, index));
  });
  const rowHeight = Math.max(1, ...wrapped.map((lines) => lines.length));
  const rendered: string[] = [];
  for (let lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
    const cells = wrapped.map((lines, columnIndex) => padCell(lines[lineIndex] || "", widths[columnIndex]));
    rendered.push(violet("│") + cells.map((cell) => ` ${cell} `).join(violet("│")) + violet("│"));
  }
  return rendered;
}

export function renderTerminalTable(columns: TerminalTableColumn[], rows: string[][]) {
  const safeColumns = columns.length ? columns : [{ label: "" }];
  const normalizedRows = rows.map((row) =>
    safeColumns.map((_, index) => String(row[index] || "").replace(/\r?\n/g, " ").trim())
  );
  const maxTableWidth = Math.max(24, terminalColumnCount() - 2);
  const widths = resolveTableColumnWidths(safeColumns, normalizedRows, maxTableWidth);
  const top = violet(`┌${widths.map((width) => "─".repeat(width + 2)).join("┬")}┐`);
  const mid = violet(`├${widths.map((width) => "─".repeat(width + 2)).join("┼")}┤`);
  const bot = violet(`└${widths.map((width) => "─".repeat(width + 2)).join("┴")}┘`);
  const headerRow = renderWrappedTableRows(
    safeColumns.map((column) => column.label),
    widths,
    (text) => cyan(bold(text))
  );
  const body = normalizedRows.flatMap((row) =>
    renderWrappedTableRows(
      row,
      widths,
      (text, columnIndex) => safeColumns[columnIndex]?.formatter?.(text) ?? styleInlineMarkdown(text)
    )
  );
  return [top, ...headerRow, mid, ...body, bot].join("\n");
}

export function renderTerminalNote(text: string) {
  const width = Math.max(16, terminalColumnCount() - 4);
  return wrapPlainText(String(text || "").trim(), width)
    .map((line) => dim(`│ ${styleInlineMarkdown(line)}`))
    .join("\n");
}

function padBorderCell(content: string, innerWidth: number) {
  const pad = Math.max(0, innerWidth - ansiDisplayWidth(content));
  return ` ${content}${" ".repeat(pad)} `;
}

/** Violet box for short multi-line terminal notices (permission gates, etc.). */
export function renderTerminalBorderedBlock(lines: string[]) {
  const cap = Math.max(20, terminalColumnCount() - 4);
  const expanded: string[] = [];
  for (const raw of lines) {
    const line = String(raw ?? "");
    if (!line) {
      expanded.push("");
      continue;
    }
    const plainWidth = Math.max(8, cap - 4);
    if (ansiDisplayWidth(line) <= plainWidth) {
      expanded.push(line);
      continue;
    }
    expanded.push(...wrapPlainText(stripAnsi(line), plainWidth));
  }
  const innerWidth = Math.min(
    cap,
    Math.max(1, ...expanded.map((line) => (line ? ansiDisplayWidth(line) : 0)))
  );
  const top = violet(`┌${"─".repeat(innerWidth + 2)}┐`);
  const bot = violet(`└${"─".repeat(innerWidth + 2)}┘`);
  const body = expanded.map((line) => {
    if (!line) return violet(`│${" ".repeat(innerWidth + 2)}│`);
    return violet("│") + padBorderCell(line, innerWidth) + violet("│");
  });
  return [top, ...body, bot].join("\n");
}

function renderTableBlockAnsi(header: string[], bodyRows: string[][]) {
  const nCols = header.length;
  const styledHead = header.map((c) => cyan(bold(styleInlineMarkdown(c))));
  const styledBody = bodyRows.map((row) => row.map((c) => styleInlineMarkdown(c)));
  const widths = Array(nCols).fill(0);

  const allRows = [styledHead, ...styledBody];
  for (const row of allRows) {
    for (let c = 0; c < nCols; c++) {
      widths[c] = Math.max(widths[c], ansiDisplayWidth(row[c]));
    }
  }

  const topInner = widths.map((w) => "─".repeat(w + 2)).join("┬");
  const midInner = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const botInner = widths.map((w) => "─".repeat(w + 2)).join("┴");
  const top = dim(`┌${topInner}┐`);
  const mid = dim(`├${midInner}┤`);
  const bot = dim(`└${botInner}┘`);

  const lineCells = (row: string[]) =>
    row.map((cell, ci) => ` ${padCell(cell, widths[ci])} `).join(dim("│"));

  const out = [top];
  out.push(dim("│") + lineCells(styledHead) + dim("│"));
  out.push(mid);
  for (const row of styledBody) {
    out.push(dim("│") + lineCells(row) + dim("│"));
  }
  out.push(bot);
  return out.join("\n");
}

export function renderMarkdownToAnsi(markdown: unknown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      inFence = !inFence;
      const lang = String(fence[1] || "").trim();
      out.push(dim(inFence ? (lang ? `┌─ code (${lang})` : "┌─ code") : "└─ end code"));
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(green(line));
      i += 1;
      continue;
    }

    const table = tryConsumeGfmTable(lines, i);
    if (table) {
      out.push(renderTableBlockAnsi(table.header, table.body));
      i = table.nextIdx;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = styleInlineMarkdown(heading[2].trim());
      out.push(level <= 2 ? cyan(bold(text)) : bold(text));
      i += 1;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(dim("─".repeat(terminalColumnCount())));
      i += 1;
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      out.push(dim(`│ ${styleInlineMarkdown(quote[1])}`));
      i += 1;
      continue;
    }
    const ulist = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ulist) {
      out.push(`${ulist[1]}• ${styleInlineMarkdown(ulist[2])}`);
      i += 1;
      continue;
    }
    const olist = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (olist) {
      out.push(`${olist[1]}${olist[2]}. ${styleInlineMarkdown(olist[3])}`);
      i += 1;
      continue;
    }
    out.push(styleInlineMarkdown(line));
    i += 1;
  }
  return out.join("\n");
}

export function renderTitleFromAgentName(profileName: unknown) {
  const firstWord = String(profileName || "Agent")
    .trim()
    .split(/\s+/)[0]
    ?.toUpperCase() || "AGENT";
  const chars = [...firstWord].filter((ch) => /[A-Z0-9]/.test(ch));
  if (!chars.length) return ["██╗  ██████╗ ███████╗███╗   ██╗████████╗"];
  const rows = ["", "", "", "", ""];
  for (const ch of chars) {
    const glyph = BLOCK_FONT[ch as BlockFontKey] || ["███  ", "█ █  ", " █   ", "█ █  ", "███  "];
    for (let i = 0; i < rows.length; i++) rows[i] += glyph[i] + "  ";
  }
  return rows.map((r) => r.trimEnd());
}

export function renderBanner(cfg: { model?: string; provider?: string } | null | undefined) {
  const agentTitle =
    process.env.WEBAGENT_AGENT_NAME || process.env.WEBAGENT_PROFILE_NAME || "Neon Oracle";
  const profileLabel =
    process.env.WEBAGENT_PERSONALITY_LABEL?.trim() ||
    agentTitle;
  const model = cfg?.model || "not configured";
  const provider = cfg?.provider || "no key";
  const line = "─".repeat(terminalColumnCount());
  const titleLines = renderTitleFromAgentName(agentTitle);
  console.log("");
  console.log(violet(line));
  for (const titleLine of titleLines) console.log(pink(titleLine));
  console.log(`${pink("🫡 Profile:")} ${bold(profileLabel)}`);
  console.log(`${blue("🧠 Model:")} ${bold(`${model} · ${provider}`)}`);
  console.log(`${amber("🛠️ Sandbox:")} ${dim(`${ROOT}  tools armed  memory local`)}`);
  const commandLine = SLASH_COMMANDS.map((command) => pink(command.name)).join(` ${dim("·")} `);
  console.log(`${cyan("⌨️ Commands:")} ${commandLine}`);
  console.log(violet(line));
  console.log("");
}

export function clearEchoedPrompt(_input: unknown) {
  // User types in the React ChatInput (not xterm), so the terminal cursor sits
  // on the "❯ " prompt line itself — just clear it in place, no cursor-up.
  process.stdout.write("\r\x1b[2K");
}

/** No continuation gutter: keep multiline assistant responses flush after the first line. */
export const BLOCK_CONTINUATION_PREFIX = "";

function isFullWidthDividerLine(line: string) {
  const plain = stripAnsi(String(line || "")).trim();
  return plain.length > 0 && /^[─━]+$/.test(plain);
}

/**
 * Indent a rendered block. When `branchBelowName` is true (default), the first
 * line uses " ⎿ " under a freshly printed speaker name; continuation segments
 * stay flush so wrapped/full-width content does not pick up extra indentation.
 */
export function prefixBlock(rendered: unknown, branchBelowName = true) {
  const lines = String(rendered || "").trimEnd().split("\n");
  const firstPrefix = branchBelowName ? " ⎿ " : BLOCK_CONTINUATION_PREFIX;
  return lines.map((line, i) => {
    if (isFullWidthDividerLine(line)) return line;
    if (i === 0) return `${firstPrefix}${line}`;
    return line.trim() ? `${BLOCK_CONTINUATION_PREFIX}${line}` : "";
  }).join("\n");
}

export function renderUserBlock(
  input: unknown,
  userName: unknown,
  cleanSetupName: (raw: unknown, fallback: string) => string
) {
  const name = cleanSetupName(userName, "You");
  process.stdout.write(`${grey(name)}\n`);
  const lines = String(input || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const prefix = i === 0 ? " ⎿ " : BLOCK_CONTINUATION_PREFIX;
    process.stdout.write(`${grey(prefix + lines[i])}\n`);
  }
  process.stdout.write("\n");
}
