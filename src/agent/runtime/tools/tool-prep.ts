import { createToolContext, withCallId } from "./context.js";
import {
  normalizeToolArguments,
  parseToolArguments,
  applyWorkspaceBrowsePathArgs,
  applyWikiPathArgs,
  applySkillNameArgAliases,
  resolveInputSchema,
} from "./argument-normalization.js";
import { toolPathStringFromArgs } from "./filesystem/path-hints.js";
import { inferEmailActionArgument } from "./email-tools.js";
import { hoistNestedToolArguments } from "./llm-arg-shape.js";
import { normalizeSkillToolCall } from "./skill-tool-normalize.js";

export type ToolExecutionContext = ReturnType<typeof createToolContext>;

type IncomingToolCall = { name?: string; arguments?: unknown };

export type PreparedToolCall = {
  name: string;
  schema: Record<string, unknown>;
  args: Record<string, unknown>;
  argsPreview: string;
  argsPreviewTruncated: boolean;
  ctx: ToolExecutionContext;
  callCtx: ToolExecutionContext & { callId: string };
  startedAt: number;
};

/** Tools whose primary file path may appear under `filename` / `file` / `target` instead of `path`. */
const PATH_ARG_ALIAS_TOOLS = new Set([
  "write_file",
  "read_file",
  "delete_file",
  "make_dir",
  "edit_file",
  "multi_edit",
  "browse_workspace",
  "list_dir",
  "tree",
  "grep",
  "find_files",
]);

function applyPathArgAliases(toolName, argsObj) {
  if (!PATH_ARG_ALIAS_TOOLS.has(toolName) || !argsObj || typeof argsObj !== "object") {
    return argsObj;
  }
  const pathStr = typeof argsObj.path === "string" ? argsObj.path.trim() : "";
  if (pathStr) return argsObj;
  const picked = toolPathStringFromArgs(argsObj);
  if (!picked) return argsObj;
  return { ...argsObj, path: picked };
}

function applyWriteFileBodyAliases(argsObj) {
  if (!argsObj || typeof argsObj !== "object") return argsObj;
  if (
    argsObj.content !== undefined ||
    argsObj.contents !== undefined
  ) {
    return argsObj;
  }
  if (typeof argsObj.text === "string") return { ...argsObj, content: argsObj.text };
  if (typeof argsObj.data === "string") return { ...argsObj, content: argsObj.data };
  return argsObj;
}

function applyWebPostArgAliases(argsObj) {
  if (!argsObj || typeof argsObj !== "object") return argsObj;
  const next = { ...argsObj };
  const urlStr = typeof next.url === "string" ? next.url.trim() : "";
  if (!urlStr) {
    if (typeof next.endpoint === "string" && next.endpoint.trim()) {
      next.url = next.endpoint.trim();
    } else if (typeof next.uri === "string" && next.uri.trim()) {
      next.url = next.uri.trim();
    }
  }
  if (next.body === undefined || next.body === null) {
    if (next.data !== undefined) {
      next.body = typeof next.data === "string" ? next.data : JSON.stringify(next.data);
    } else if (next.payload !== undefined) {
      next.body =
        typeof next.payload === "string" ? next.payload : JSON.stringify(next.payload);
    } else if (next.json !== undefined) {
      next.body = typeof next.json === "string" ? next.json : JSON.stringify(next.json);
    }
  }
  return next;
}

function applyRunShellArgAliases(argsObj) {
  if (!argsObj || typeof argsObj !== "object") return argsObj;
  const cmdStr = typeof argsObj.command === "string" ? argsObj.command.trim() : "";
  if (cmdStr) return argsObj;
  if (typeof argsObj.cmd === "string" && argsObj.cmd.trim()) {
    return { ...argsObj, command: argsObj.cmd.trim() };
  }
  if (typeof argsObj.shell === "string" && argsObj.shell.trim()) {
    return { ...argsObj, command: argsObj.shell.trim() };
  }
  if (typeof argsObj.script === "string" && argsObj.script.trim()) {
    return { ...argsObj, command: argsObj.script.trim() };
  }
  return argsObj;
}

function nextCallId(runId, index) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const prefix = runId ? String(runId) : "call";
  return `${prefix}_${stamp}_${rand}_${index}`;
}

export function buildArgsPreview(args) {
  try {
    const json = JSON.stringify(args);
    const argsPreviewTruncated = json.length > 120;
    return {
      argsPreview: argsPreviewTruncated ? json.slice(0, 120) : json,
      argsPreviewTruncated,
    };
  } catch {
    return { argsPreview: "{}", argsPreviewTruncated: false };
  }
}

/** Shared registry prep path (wire repair → aliases → schema normalize). Exported for benchmarks. */
export function prepareIncomingToolArguments(
  toolName: string,
  rawArgs: unknown,
  catalogEntry?: { inputSchema?: Record<string, unknown> } | null
): { schema: ReturnType<typeof resolveInputSchema>; args: Record<string, unknown>; name: string } {
  let name = String(toolName || "").trim();
  let parsed = parseToolArguments(rawArgs, name);
  parsed = hoistNestedToolArguments(name, parsed) as Record<string, unknown>;

  if (name === "email") {
    parsed = inferEmailActionArgument(parsed) as Record<string, unknown>;
  }

  let argsForNormalize = parsed;
  if (!argsForNormalize || typeof argsForNormalize !== "object" || Array.isArray(argsForNormalize)) {
    argsForNormalize = {};
  } else {
    const normalizedSkill = normalizeSkillToolCall(name, argsForNormalize, name);
    name = normalizedSkill.name;
    argsForNormalize = normalizedSkill.args;
    argsForNormalize = applyPathArgAliases(name, { ...argsForNormalize });
    argsForNormalize = applySkillNameArgAliases(name, argsForNormalize);
    argsForNormalize = applyWorkspaceBrowsePathArgs(name, argsForNormalize);
    argsForNormalize = applyWikiPathArgs(name, argsForNormalize);
    if (name === "write_file") {
      argsForNormalize = applyWriteFileBodyAliases(argsForNormalize);
    }
    if (name === "web_post") {
      argsForNormalize = applyWebPostArgAliases(argsForNormalize);
    }
    if (name === "run_shell") {
      argsForNormalize = applyRunShellArgAliases(argsForNormalize);
    }
  }

  const schema = resolveInputSchema(catalogEntry);
  const args = normalizeToolArguments(argsForNormalize, schema, name);
  return { schema, args, name };
}

export function prepareToolCall({
  call,
  ctx,
  toolCatalog,
  index,
}: {
  call: IncomingToolCall;
  ctx: ToolExecutionContext;
  toolCatalog: Record<string, unknown>;
  index: number;
}): PreparedToolCall {
  const rawName = typeof call?.name === "string" ? call.name : "";
  const catalogEntry = toolCatalog?.[rawName] as { inputSchema?: Record<string, unknown> } | undefined;
  const { schema, args, name } = prepareIncomingToolArguments(rawName, call.arguments, catalogEntry);
  const { argsPreview, argsPreviewTruncated } = buildArgsPreview(args);
  const callCtx = withCallId(ctx, nextCallId(ctx.runId, index));
  return {
    name,
    schema,
    args,
    argsPreview,
    argsPreviewTruncated,
    ctx,
    callCtx,
    startedAt: Date.now(),
  };
}
