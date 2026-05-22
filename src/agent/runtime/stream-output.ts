/**
 * Terminal output and buffering for smooth streaming.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { summarizeToolResultPreview } from "./tool-result-preview.js";

export function summarizeToolExecutions(exec, snapshotRefs = []) {
  return exec.map((item, index) => {
    const hasError = !!item?.error;
    const aborted = !!item?.aborted;
    const resultRef = snapshotRefs[index] || undefined;
    let summary;
    if (hasError) {
      summary = `failed: ${String(item.error || "unknown error").slice(0, 220)}`;
      if (resultRef) summary += ` (full error payload spilled: use read_file on "${resultRef}")`;
    } else if (resultRef) {
      summary = `payload_spilled_to_snapshot: full tool result is only in "${resultRef}" — call read_file with that path; the inline body was not included here`;
      const tr = item?.result;
      if (tr && typeof tr === "object" && tr.truncated === true) {
        summary += ` [fetch_truncated: spilled payload may be partial (${tr.truncated_at_chars ?? "?"} char cap) — narrow scope or grep/read within file]`;
      }
    } else {
      const preview = summarizeToolResultPreview(item?.result);
      summary = `result: ${preview}`;
      const r = item?.result;
      if (r && typeof r === "object" && r.truncated === true) {
        summary += ` [fetch_truncated: partial response only (${r.truncated_at_chars ?? "?"} char cap) — narrow scope, fetch a smaller URL, or search inside spilled/read_file content; do not assume text continues beyond this cut]`;
      }
    }
    const row = {
      tool: String(item?.tool || "unknown"),
      status: hasError ? "error" : "ok",
      aborted,
      error: hasError ? String(item.error) : undefined,
      summary,
      ...(resultRef ? { result_ref: resultRef } : {}),
    };
    if (hasError && item?.error_code) {
      row.error_code = String(item.error_code);
    }
    if (hasError && item?.recovery_hint) {
      row.recovery_hint = String(item.recovery_hint).slice(0, 320);
    }
    if (hasError && typeof item?.retryable === "boolean") {
      row.retryable = item.retryable;
    }
    if (hasError && item?.fail_reason) {
      row.fail_reason = String(item.fail_reason);
    }
    const fullInlined =
      !hasError && !aborted && !resultRef && item?.result !== undefined && item?.result !== null;
    if (fullInlined) {
      row.result = item.result;
    }
    return row;
  });
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function toolExecutionKey(tool) {
  return `${String(tool?.name || "")}:${stableStringify(tool?.arguments ?? {})}`;
}

/** Prior user message (not the current turn), for topic-pivot detection. */
export function getPreviousUserMessageContent(messages) {
  const users = [...(messages || [])].filter((m) => m && m.role === "user");
  if (users.length < 2) return null;
  const text = String(users[users.length - 2]?.content || "").trim();
  return text || null;
}

export function createRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Yields the event loop so the host can flush small stdout chunks (smoother than one giant write). */
export function takeStdoutAtom(buffer) {
  if (!buffer.length) return { atom: "", rest: "" };
  if (buffer.startsWith("\r\n")) return { atom: "\r\n", rest: buffer.slice(2) };
  const c0 = buffer[0];
  if (c0 === "\n" || c0 === "\r") return { atom: c0, rest: buffer.slice(1) };
  if (c0 === "\x1b") {
    if (buffer.length < 2) return { atom: buffer, rest: "", partial: true };
    const c1 = buffer[1];
    if (c1 === "[") {
      for (let i = 2; i < buffer.length; i++) {
        const code = buffer.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) {
          return { atom: buffer.slice(0, i + 1), rest: buffer.slice(i + 1) };
        }
      }
      return { atom: buffer, rest: "", partial: true };
    }
    if (c1 === "]" || c1 === "P") {
      for (let i = 2; i < buffer.length; i++) {
        if (buffer.charCodeAt(i) === 0x07) {
          return { atom: buffer.slice(0, i + 1), rest: buffer.slice(i + 1) };
        }
        if (buffer[i] === "\x1b" && buffer[i + 1] === "\\") {
          return { atom: buffer.slice(0, i + 2), rest: buffer.slice(i + 2) };
        }
      }
      return { atom: buffer, rest: "", partial: true };
    }
    if (c1 === "(" || c1 === ")") {
      if (buffer.length < 3) return { atom: buffer, rest: "", partial: true };
      return { atom: buffer.slice(0, 3), rest: buffer.slice(3) };
    }
    return { atom: buffer.slice(0, 2), rest: buffer.slice(2) };
  }
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = seg.segment(buffer)[Symbol.iterator]().next().value;
    if (first?.segment) {
      return { atom: first.segment, rest: buffer.slice(first.segment.length) };
    }
  } catch {
    /* ignore */
  }
  const cp = buffer.codePointAt(0);
  if (cp === undefined) return { atom: "", rest: "" };
  const len = cp > 0xffff ? 2 : 1;
  return { atom: buffer.slice(0, len), rest: buffer.slice(len) };
}

export async function writeStdoutSmoothed(text) {
  let buf = text;
  let n = 0;
  while (buf.length) {
    const { atom, rest, partial } = takeStdoutAtom(buf);
    if (partial) {
      process.stdout.write(buf);
      return;
    }
    if (!atom) {
      process.stdout.write(buf);
      return;
    }
    process.stdout.write(atom);
    buf = rest;
    n += 1;
    if (n % 8 === 0) await sleep(0);
  }
}
