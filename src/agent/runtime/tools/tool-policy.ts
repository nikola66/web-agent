/**
 * Classification and human gates for risky tool calls.
 */

import { TOOL_CONFIRM_END, TOOL_CONFIRM_START } from "../constants.js";
import {
  R,
  amber,
  bold,
  cyan,
  dim,
  green,
  normalizeEmojiSpacing,
  red,
  renderTerminalBorderedBlock,
  styleInlineMarkdown,
  terminalColumnCount,
  violet,
} from "../terminal-format.js";
import { expandSkillBulkSaveArgs } from "./skill-bulk-args.js";

function interpolateTemplate(template, args) {
  if (!template || typeof template !== "string") return null;
  const a = args && typeof args === "object" ? args : {};
  let result = template;

  // Count items for bulk operations
  if (Array.isArray(a.items)) {
    result = result.replace(/{{items_count}}/g, a.items.length);
    let nUrl = 0;
    let nInline = 0;
    for (const it of a.items) {
      if (it && typeof it === "object" && !Array.isArray(it)) {
        const url = typeof it.url === "string" ? it.url.trim() : "";
        if (url) nUrl += 1;
        else nInline += 1;
      }
    }
    result = result.replace(/{{inline_count}}/g, nInline);
    result = result.replace(/{{url_count}}/g, nUrl);
  }

  // Replace field placeholders
  const fieldRegex = /{{([a-z_]+)}}/g;
  result = result.replace(fieldRegex, (match, key) => {
    const value = a[key];
    if (value === undefined || value === null) return "";
    if (typeof value === "string") {
      let truncated = value.replace(/\s+/g, " ").trim();
      if (key === "description" && truncated.length > 80) {
        truncated = `${truncated.slice(0, 77)}…`;
      }
      if (key === "subject" && truncated.length > 100) {
        truncated = `${truncated.slice(0, 97)}…`;
      }
      return truncated;
    }
    return String(value);
  });

  return result.length > 0 ? result : null;
}

function formatContentLength(content) {
  if (typeof content === "string") return `${content.length} chars`;
  return "";
}

function truncateDescription(desc) {
  if (typeof desc !== "string") return "";
  let truncated = desc.replace(/\s+/g, " ").trim();
  if (truncated.length > 80) {
    truncated = `${truncated.slice(0, 77)}…`;
  }
  return truncated;
}

export function summarizeToolApproval(name, args, approvalSummaryTemplate) {
  const tool = String(name || "tool");

  // Use approvalSummary template if provided
  if (approvalSummaryTemplate) {
    const interpolated = interpolateTemplate(approvalSummaryTemplate, args);
    if (interpolated) return interpolated;
  }

  // Email tool has special handling
  if (tool.startsWith("email:")) {
    const action = tool.slice("email:".length).trim() || "(action)";
    const a = args && typeof args === "object" ? args : {};
    if (action === "send") {
      const nested =
        a.arguments && typeof a.arguments === "object" && !Array.isArray(a.arguments)
          ? a.arguments
          : {};
      const to = String(a.to ?? nested.to ?? "").trim();
      let subject = String(a.subject ?? nested.subject ?? "").replace(/\s+/g, " ").trim();
      if (subject.length > 100) subject = `${subject.slice(0, 97)}…`;
      const parts = [];
      if (to) parts.push(`to=${to}`);
      if (subject) parts.push(`subject=${subject}`);
      return `email:${action}: ${parts.length ? parts.join("; ") : "(no recipient)"}`;
    }
    return `email:${action}`;
  }

  // Per-tool summarization
  const a = args && typeof args === "object" ? args : {};

  if (tool === "skill_save") {
    const name = String(a.name ?? "").trim();
    const desc = truncateDescription(a.description);
    const contentLen = formatContentLength(a.content);
    const parts = [];
    if (name) parts.push(`name=${name}`);
    if (desc) parts.push(`description=${desc}`);
    if (contentLen) parts.push(`content=${contentLen}`);
    return `skill_save: ${parts.join("; ")}`;
  }

  if (tool === "skill_delete") {
    const name = String(a.name ?? "").trim();
    return `skill_delete: name=${name}`;
  }

  if (tool === "skill_manage") {
    const action = String(a.action ?? "").trim();
    const name = String(a.name ?? "").trim();
    const contentLen = formatContentLength(a.content);
    const parts = [];
    if (action) parts.push(`action=${action}`);
    if (name) parts.push(`name=${name}`);
    if (contentLen) parts.push(`content=${contentLen}`);
    return `skill_manage: ${parts.join("; ")}`;
  }

  if (tool === "skill_bulk_save") {
    const expanded = expandSkillBulkSaveArgs(a);
    const items = Array.isArray(expanded.items) ? expanded.items : [];
    let nUrl = 0;
    let nInline = 0;
    const previews = [];
    for (const it of items) {
      if (it && typeof it === "object" && !Array.isArray(it)) {
        const url = typeof it.url === "string" ? it.url.trim() : "";
        if (url) {
          nUrl += 1;
        } else {
          nInline += 1;
          const itName = String(it.name ?? "").trim();
          if (itName && previews.length < 5) {
            previews.push(itName);
          }
        }
      }
    }
    let result = `skill_bulk_save: total=${items.length}; inline=${nInline}; url=${nUrl}`;
    if (previews.length > 0) {
      result += `; ${previews.join(", ")}`;
    }
    if (nInline + nUrl > 5) {
      result += `; +5 more`;
    }
    return result;
  }

  // Fallback: JSON representation of args
  try {
    const preview = JSON.stringify(a);
    if (preview.length > 420) return `${tool}: ${preview.slice(0, 420)}…`;
    return `${tool}: ${preview}`;
  } catch {
    return `${tool}`;
  }
}

const MAX_PERMISSION_LINE = 280;

function truncatePermissionText(text, max = MAX_PERMISSION_LINE) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function nestedArgs(args) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const nested =
    a.arguments && typeof a.arguments === "object" && !Array.isArray(a.arguments)
      ? a.arguments
      : {};
  return { flat: a, nested };
}

function formatToolBadge(toolLabel, toolEmoji) {
  const tool = String(toolLabel || "tool").trim() || "tool";
  const em = normalizeEmojiSpacing(String(toolEmoji || "").trim());
  const colon = tool.indexOf(":");
  if (colon > 0) {
    const base = tool.slice(0, colon);
    const action = tool.slice(colon + 1).trim() || "run";
    const head = em ? `${em} ${base}` : base;
    return cyan(bold(`${head} · ${action}`));
  }
  return em ? cyan(bold(`${em} ${tool}`)) : cyan(bold(tool));
}

/** @returns {Array<{ label: string; value: string }>} */
function buildApprovalDetailRows(toolLabel, args, summary, toolEmoji) {
  const tool = String(toolLabel || "tool").trim() || "tool";
  const em = String(toolEmoji || "").trim();
  const { flat, nested } = nestedArgs(args);

  if (tool.startsWith("email:")) {
    const action = tool.slice("email:".length).trim() || "send";
    let to = String(flat.to ?? nested.to ?? "").trim();
    let subject = String(flat.subject ?? nested.subject ?? "").replace(/\s+/g, " ").trim();
    const sum = String(summary || "");
    if (!to) {
      const m = sum.match(/(?:^|;)\s*to=([^;]+)/i);
      if (m) to = m[1].trim();
    }
    if (!subject) {
      const m = sum.match(/(?:^|;)\s*subject=([^;]+)/i);
      if (m) subject = m[1].trim();
    }
    const hasEmailFields = Boolean(to || subject);
    const looksLikeEmailSummary = /(?:^|;)\s*(?:to|subject)=/i.test(sum);
    if (hasEmailFields || looksLikeEmailSummary || Object.keys(flat).length > 0) {
      const rows = [{ label: "🔧 Tool", value: formatToolBadge(tool, em || "✉️") }];
      if (action === "send") {
        if (subject.length > 100) subject = `${subject.slice(0, 97)}…`;
        if (to) rows.push({ label: "📬 To", value: bold(to) });
        if (subject) rows.push({ label: "📋 Subject", value: styleInlineMarkdown(subject) });
        if (!to && !subject) rows.push({ label: "⚠️", value: dim("(no recipient details)") });
      }
      return rows;
    }
  }

  if (tool === "skill_save" || tool === "skill_delete" || tool === "skill_manage") {
    const rows = [{ label: "🔧 Tool", value: formatToolBadge(tool, em || "📦") }];
    const name = String(flat.name ?? "").trim();
    const desc = truncatePermissionText(truncateDescription(flat.description), 80);
    const contentLen = formatContentLength(flat.content);
    if (name) rows.push({ label: "🏷️ Name", value: bold(name) });
    if (desc) rows.push({ label: "📝 About", value: styleInlineMarkdown(desc) });
    if (flat.action) rows.push({ label: "⚙️ Action", value: cyan(String(flat.action)) });
    if (contentLen) rows.push({ label: "📄 Content", value: dim(contentLen) });
    return rows;
  }

  if (tool === "skill_bulk_save") {
    const line = truncatePermissionText(
      summarizeToolApproval(tool, flat) || String(summary || "").trim() || tool
    );
    return [
      { label: "🔧 Tool", value: formatToolBadge(tool, em || "📦") },
      { label: "📚 Batch", value: styleInlineMarkdown(line.replace(/^skill_bulk_save:\s*/, "")) },
    ];
  }

  if (tool === "delete_file") {
    const path = String(flat.path ?? "").trim();
    return [
      { label: "🔧 Tool", value: formatToolBadge(tool, em || "🗑️") },
      { label: "📁 Path", value: path ? amber(path) : dim("(unknown path)") },
    ];
  }

  const fromSummary = String(summary || "").trim();
  const fallback = args ? summarizeToolApproval(tool, flat) : "";
  let detail = (fromSummary || fallback || "").trim();
  if (tool && tool !== "tool" && detail && !detail.startsWith(tool)) {
    detail = `${tool}: ${detail}`;
  }
  if (!detail) detail = tool;
  detail = truncatePermissionText(detail);

  const kvRows = [];
  for (const piece of detail.split(";")) {
    const seg = piece.trim();
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq > 0) {
      const key = seg.slice(0, eq).trim();
      const val = seg.slice(eq + 1).trim();
      const label = key.toLowerCase() === "to" ? "📬 To" : key.toLowerCase() === "subject" ? "📋 Subject" : `• ${key}`;
      kvRows.push({ label, value: styleInlineMarkdown(val) });
    } else if (kvRows.length === 0) {
      kvRows.push({ label: "📌", value: styleInlineMarkdown(seg) });
    } else {
      kvRows[kvRows.length - 1].value += `; ${styleInlineMarkdown(seg)}`;
    }
  }

  return [
    { label: "🔧 Tool", value: formatToolBadge(tool, em) },
    ...(kvRows.length ? kvRows : [{ label: "📌", value: styleInlineMarkdown(detail) }]),
  ];
}

function renderApprovalRow({ label, value }) {
  const tag = `${label.padEnd(10, " ")}`;
  return `${dim(tag)} ${value}`;
}

/**
 * Styled multi-line block printed before readline asks for y/n (works in xterm + chat echo).
 * Only `y` / `yes` (case-insensitive) approve; everything else including empty = deny.
 */
export function formatApprovalTerminalBlock({ toolLabel, summary, args, toolEmoji } = {}) {
  const detailRows = buildApprovalDetailRows(toolLabel, args, summary, toolEmoji);
  const boxLines = [
    `${amber("🔐")} ${violet(bold("Permission required"))}`,
    "",
    ...detailRows.map(renderApprovalRow),
    "",
    dim("─".repeat(Math.min(24, Math.max(12, terminalColumnCount() - 12)))),
    "",
    `${green("✅ Approve")}${R}  ${green("y")}${R} or ${green("yes")}${R}, then ${dim("Enter")}`,
    `${red("❌ Deny")}${R}     ${dim("Enter")}, ${green("n")}${R}/${green("no")}${R}, or anything else`,
  ];
  return `\n${renderTerminalBorderedBlock(boxLines)}\n\n`;
}

/**
 * Blocking approval for destructive / sensitive operations.
 * @param {{ ctx: Record<string, unknown>; risky?: boolean; toolLabel: string; summary: string; args?: unknown }} p
 */
export async function gateToolExecution(p) {
  const { ctx, risky = false, toolLabel, summary, args, toolEmoji } = p;
  if (!risky || ctx?.autoApprove || typeof ctx?.ask !== "function") {
    return true;
  }
  const payload = { tool: toolLabel, summary: String(summary || "").slice(0, 800) };
  process.stdout.write(
    `${TOOL_CONFIRM_START}${JSON.stringify(payload)}${TOOL_CONFIRM_END}\n`
  );
  process.stdout.write(
    formatApprovalTerminalBlock({ toolLabel, summary, args, toolEmoji })
  );
  return ctx.ask({ kind: "approval" });
}
