/**
 * Classification and human gates for risky tool calls.
 */

import { TOOL_CONFIRM_END, TOOL_CONFIRM_START } from "../constants.js";
import { R, bold, green, violet } from "../terminal-format.js";
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

/**
 * Styled multi-line block printed before readline asks for y/n (works in xterm + chat echo).
 * Only `y` / `yes` (case-insensitive) approve; everything else including empty = deny.
 */
export function formatApprovalTerminalBlock({ toolLabel, summary, args } = {}) {
  const tool = String(toolLabel || "tool").trim() || "tool";
  const fromSummary = String(summary || "").trim();
  const fallback = args ? summarizeToolApproval(tool, args) : "";
  let line = (fromSummary || fallback || tool).trim();
  if (tool && tool !== "tool" && line && !line.startsWith(tool)) {
    line = `${tool}: ${line}`;
  }
  const needsLine =
    line.length > MAX_PERMISSION_LINE ? `${line.slice(0, MAX_PERMISSION_LINE - 1)}…` : line;

  const lines = [
    "",
    violet("── Permission required ──"),
    `  ${needsLine}`,
    "",
    `  ${bold("Approve")}${R}: ${green("y")}${R} or ${green("yes")}${R}, then Enter`,
    `  ${bold("Deny")}${R}: empty Enter, ${green("n")}${R}/${green("no")}${R}, or anything else`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Blocking approval for destructive / sensitive operations.
 * @param {{ ctx: Record<string, unknown>; risky?: boolean; toolLabel: string; summary: string; args?: unknown }} p
 */
export async function gateToolExecution(p) {
  const { ctx, risky = false, toolLabel, summary, args } = p;
  if (!risky || ctx?.autoApprove || typeof ctx?.ask !== "function") {
    return true;
  }
  const payload = { tool: toolLabel, summary: String(summary || "").slice(0, 800) };
  process.stdout.write(
    `${TOOL_CONFIRM_START}${JSON.stringify(payload)}${TOOL_CONFIRM_END}\n`
  );
  process.stdout.write(
    formatApprovalTerminalBlock({ toolLabel, summary, args })
  );
  return ctx.ask({ kind: "approval" });
}
