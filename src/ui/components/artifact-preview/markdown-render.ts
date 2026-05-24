import MarkdownIt from "markdown-it";
import { katex } from "@mdit/plugin-katex";
import { mark as markPlugin } from "@mdit/plugin-mark";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import taskLists from "markdown-it-task-lists";

const ALERT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
type AlertType = (typeof ALERT_TYPES)[number];

const ALERT_LABEL: Record<AlertType, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

const HLJS_LANGS: Array<[string, typeof javascript]> = [
  ["bash", bash],
  ["sh", bash],
  ["shell", shell],
  ["css", css],
  ["diff", diff],
  ["dockerfile", dockerfile],
  ["go", go],
  ["graphql", graphql],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["js", javascript],
  ["json", json],
  ["kotlin", kotlin],
  ["markdown", markdown],
  ["md", markdown],
  ["php", php],
  ["plaintext", plaintext],
  ["text", plaintext],
  ["txt", plaintext],
  ["python", python],
  ["py", python],
  ["ruby", ruby],
  ["rb", ruby],
  ["rust", rust],
  ["rs", rust],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["ts", typescript],
  ["tsx", typescript],
  ["jsx", javascript],
  ["html", xml],
  ["xml", xml],
  ["yaml", yaml],
  ["yml", yaml],
];

for (const [name, lang] of HLJS_LANGS) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang);
}

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function highlightCode(code: string, lang: string): string {
  const normalized = lang.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (normalized && hljs.getLanguage(normalized)) {
    try {
      return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value;
    } catch {
      /* fall through */
    }
  }
  try {
    const auto = hljs.highlightAuto(code);
    return auto.value;
  } catch {
    return MarkdownIt().utils.escapeHtml(code);
  }
}

function isMermaidFence(info: string): boolean {
  const tag = info.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return tag === "mermaid";
}

function parseAlertMarker(content: string): { type: AlertType; rest: string } | null {
  const match = content.trim().match(/^\[!(\w+)\]\s*(?:<br\s*\/?>|\n)?([\s\S]*)$/i);
  if (!match) return null;
  const kind = match[1].toLowerCase() as AlertType;
  if (!ALERT_TYPES.includes(kind)) return null;
  return { type: kind, rest: match[2].trim() };
}

type MdToken = {
  type: string;
  content: string;
  tag: string;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
  attrJoin(name: string, value: string): void;
};

function findBlockquoteAlert(tokens: MdToken[], openIdx: number): { type: AlertType; rest: string } | null {
  for (let i = openIdx + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "blockquote_close") break;
    if (token.type === "inline") {
      return parseAlertMarker(token.content);
    }
    if (token.type === "blockquote_open") break;
  }
  return null;
}

function strikethroughPlugin(md: MarkdownIt) {
  md.inline.ruler.before("emphasis", "strikethrough", (state, silent) => {
    const max = state.posMax;
    if (state.src.charCodeAt(state.pos) !== 0x7e /* ~ */) return false;
    if (state.pos + 1 >= max || state.src.charCodeAt(state.pos + 1) !== 0x7e) return false;

    let scanned = state.pos + 2;
    while (scanned < max) {
      if (
        state.src.charCodeAt(scanned) === 0x7e &&
        scanned + 1 < max &&
        state.src.charCodeAt(scanned + 1) === 0x7e
      ) {
        if (!silent) {
          const open = state.push("s_open", "s", 1);
          open.markup = "~~";
          state.push("text", "", 0).content = state.src.slice(state.pos + 2, scanned);
          const close = state.push("s_close", "s", -1);
          close.markup = "~~";
        }
        state.pos = scanned + 2;
        return true;
      }
      scanned++;
    }
    return false;
  });
}

function stripAlertInline(inline: MdToken & { children?: MdToken[] }) {
  const parsed = parseAlertMarker(inline.content);
  if (!parsed) return false;

  inline.content = parsed.rest;
  const children = inline.children ?? [];
  if (!parsed.rest) {
    inline.children = [];
    return true;
  }

  let start = 0;
  if (children[0]?.type === "text" && /^\[!(\w+)\]\s*$/i.test(String(children[0].content).trim())) {
    start = 1;
    if (children[start]?.type === "softbreak" || children[start]?.type === "hardbreak") start += 1;
  }
  inline.children = children.slice(start);
  if (inline.children[0]?.type === "text") inline.children[0].content = parsed.rest;
  return true;
}

function githubAlertsPlugin(md: MarkdownIt) {
  md.core.ruler.push("github_alerts_children", (state) => {
    const tokens = state.tokens as Array<MdToken & { children?: MdToken[]; meta?: { alertType?: AlertType } }>;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") continue;
      const alert = findBlockquoteAlert(tokens, i);
      if (!alert) continue;
      tokens[i].meta = { alertType: alert.type };

      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === "blockquote_close") break;
        if (tokens[j].type !== "inline") continue;
        stripAlertInline(tokens[j]);
        break;
      }
    }
  });

  const defaultBlockquoteOpen =
    md.renderer.rules.blockquote_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    const alertType = (tokens[idx] as MdToken & { meta?: { alertType?: AlertType } }).meta?.alertType;
    if (alertType) {
      return `<blockquote class="md-alert md-alert-${alertType}"><p class="md-alert-title">${ALERT_LABEL[alertType]}</p>\n`;
    }
    return defaultBlockquoteOpen(tokens, idx, options, env, self);
  };

  const defaultParagraphOpen =
    md.renderer.rules.paragraph_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
    const inline = tokens[idx + 1] as (MdToken & { children?: MdToken[] }) | undefined;
    if (inline?.type === "inline" && (!inline.children || inline.children.length === 0)) return "";
    return defaultParagraphOpen(tokens, idx, options, env, self);
  };

  const defaultParagraphClose =
    md.renderer.rules.paragraph_close ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.paragraph_close = (tokens, idx, options, env, self) => {
    const inline = tokens[idx - 1] as (MdToken & { children?: MdToken[] }) | undefined;
    if (inline?.type === "inline" && (!inline.children || inline.children.length === 0)) return "";
    return defaultParagraphClose(tokens, idx, options, env, self);
  };
}

function headingAnchorsPlugin(md: MarkdownIt) {
  const defaultHeadingOpen =
    md.renderer.rules.heading_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const inline = tokens[idx + 1];
    const slug = slugifyHeading(inline?.content ?? "");
    if (slug) {
      return `<${token.tag} id="${slug}" class="md-heading"><a class="md-heading-anchor" href="#${slug}" aria-hidden="true">#</a>`;
    }
    return defaultHeadingOpen(tokens, idx, options, env, self);
  };
}

function tableScrollPlugin(md: MarkdownIt) {
  const defaultTableOpen =
    md.renderer.rules.table_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  const defaultTableClose =
    md.renderer.rules.table_close ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
    `<div class="md-table-wrap">${defaultTableOpen(tokens, idx, options, env, self)}`;
  md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
    `${defaultTableClose(tokens, idx, options, env, self)}</div>`;
}

function externalLinksPlugin(md: MarkdownIt) {
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true })
  .use(katex, { delimiters: "dollars", throwOnError: false })
  .use(markPlugin)
  .use(taskLists, { enabled: true, label: true, labelAfter: true })
  .use(strikethroughPlugin)
  .use(githubAlertsPlugin)
  .use(headingAnchorsPlugin)
  .use(tableScrollPlugin)
  .use(externalLinksPlugin);

md.enable(["table"]);

const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info || "";
  if (isMermaidFence(info)) {
    const encoded = encodeURIComponent(token.content);
    return `<div class="mermaid-block" data-code="${encoded}"></div>`;
  }

  const lang = info.trim().split(/\s+/)[0] ?? "";
  const highlighted = highlightCode(token.content, lang);
  const label = lang ? `<span class="md-code-lang">${md.utils.escapeHtml(lang)}</span>` : "";
  return `<div class="md-code-block">${label}<pre><code class="hljs language-${md.utils.escapeHtml(lang || "plaintext")}">${highlighted}</code></pre></div>`;
};

export function renderArtifactMarkdown(text: string, mermaidOnly = false): string {
  if (mermaidOnly) {
    const encoded = encodeURIComponent(text);
    return `<div class="mermaid-block" data-code="${encoded}"></div>`;
  }
  return md.render(text);
}

export function escapeArtifactHtml(text: string): string {
  return md.utils.escapeHtml(text);
}
