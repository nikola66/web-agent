import fs from "node:fs/promises";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { CAPABILITIES_DIR, WS } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { recordToolFailure, recordToolSuccess } from "../memory/index.js";
import { dim, green, red } from "../terminal-format.js";
import {
  createToolResultTranscriptEvent,
  createToolStartTranscriptEvent,
  formatToolResultTranscript,
  formatToolStartTranscript,
  type ToolResultTranscriptEventInput,
  type ToolStartTranscriptEventInput,
} from "../transcript.js";
import { emitTranscriptEvent } from "../transcript-delivery.js";
import { errorMessage } from "../utils.js";
import { createToolContext, withCallId } from "./context.js";
import { BUILTIN_TOOL_DEFINITIONS } from "./builtins/index.js";
import type { ToolDefinition, ToolImplementFn } from "./definition.js";
import {
  normalizeToolArguments,
  resolveInputSchema,
  validateRequiredArguments,
} from "./argument-normalization.js";
import { toolPathStringFromArgs } from "./filesystem/path-hints.js";
import { inferEmailActionArgument } from "./email-tools.js";
import { hoistNestedToolArguments } from "./llm-arg-shape.js";
import { gateToolExecution, summarizeToolApproval } from "./tool-policy.js";
import { expandSkillBulkSaveArgs } from "./skill-bulk-args.js";
import { classifyToolError } from "./error-classifier.js";

type ToolExecutionContext = ReturnType<typeof createToolContext>;

type CapabilityCatalogEntry = {
  id: string;
  emoji: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation: boolean;
  order?: number;
};

function isValidToolName(name) {
  return /^[a-z][a-z0-9_]*$/.test(String(name || ""));
}

function toBuiltinEntry(def: ToolDefinition) {
  return {
    fn: def.run,
    emoji: def.emoji,
    description: def.description,
    inputSchema: def.inputSchema,
    ...(def.requiresConfirmation !== undefined ? { requiresConfirmation: def.requiresConfirmation } : {}),
    ...(def.approvalSummary !== undefined ? { approvalSummary: def.approvalSummary } : {}),
  };
}

function buildBuiltinTools(definitions: readonly ToolDefinition[]) {
  const seen = new Set<string>();
  return Object.fromEntries(definitions.map((def) => {
    if (!isValidToolName(def.name)) throw new Error(`Invalid built-in tool name: ${def.name}`);
    if (seen.has(def.name)) throw new Error(`Duplicate built-in tool name: ${def.name}`);
    seen.add(def.name);
    return [def.name, toBuiltinEntry(def)];
  }));
}

export const BUILTIN_TOOLS = buildBuiltinTools(BUILTIN_TOOL_DEFINITIONS);

export const TOOLS = Object.fromEntries(
  Object.entries(BUILTIN_TOOLS).map(([name, entry]) => [
    name,
    (typeof entry === "function" ? entry : entry.fn) as ToolImplementFn,
  ])
);

let capabilityToolsCache: Record<string, ToolImplementFn> | null = null;
let toolsCache: Record<string, ToolImplementFn> | null = null;
let capabilityToolCatalogCache: Record<string, CapabilityCatalogEntry> | null = null;

/** Tools whose primary file path may appear under `filename` / `file` / `target` instead of `path`. */
const PATH_ARG_ALIAS_TOOLS = new Set([
  "write_file",
  "read_file",
  "delete_file",
  "make_dir",
  "edit_file",
  "multi_edit",
  "file_stat",
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

function capabilityToolRoots() {
  return [
    nodePath.join(CAPABILITIES_DIR, "tools"),
    nodePath.join(WS, "src", "capabilities", "tools"),
  ];
}

function normalizeToolManifest(
  manifest: unknown,
  fallbackId: string
): CapabilityCatalogEntry | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const m = manifest as Record<string, unknown>;
  const id = String(m.id || fallbackId || "").trim();
  if (!isValidToolName(id)) return null;
  const schema =
    m.inputSchema && typeof m.inputSchema === "object" && !Array.isArray(m.inputSchema)
      ? (m.inputSchema as Record<string, unknown>)
      : { type: "object", additionalProperties: true };
  return {
    id,
    emoji: String(m.emoji || "🧩"),
    description: String(m.description || `Invoke the ${id} capability.`),
    inputSchema: schema,
    requiresConfirmation: Boolean(m.requiresConfirmation),
    order: Number.isFinite(Number(m.order)) ? Number(m.order) : undefined,
  };
}

async function loadCapabilityTools(): Promise<{
  tools: Record<string, ToolImplementFn>;
  catalog: Record<string, CapabilityCatalogEntry>;
}> {
  if (capabilityToolsCache && capabilityToolCatalogCache) {
    return { tools: capabilityToolsCache, catalog: capabilityToolCatalogCache };
  }
  const tools: Record<string, ToolImplementFn> = {};
  const catalog: Record<string, CapabilityCatalogEntry> = {};
  for (const root of capabilityToolRoots()) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = nodePath.join(root, entry.name);
    const manifestPath = nodePath.join(dir, "manifest.json");
    const handlerPath = nodePath.join(dir, "handler.js");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const manifest = normalizeToolManifest(JSON.parse(raw), entry.name);
      if (!manifest) {
        await logDebugEvent("capability_tool_skipped", {
          folder: entry.name,
          reason: "invalid manifest",
        });
        continue;
      }
      const stat = await fs.stat(handlerPath).catch(() => null);
      if (!stat?.isFile()) {
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "missing handler.js",
        });
        continue;
      }
      if (BUILTIN_TOOLS[manifest.id]) {
        console.warn(`[tools] capability "${manifest.id}" shadows built-in; skipped (${dir})`);
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "duplicate built-in tool",
        });
        continue;
      }
      if (tools[manifest.id]) {
        console.warn(`[tools] capability "${manifest.id}" already loaded; skipped (${dir})`);
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "duplicate capability tool",
        });
        continue;
      }
      const mod = await import(/* @vite-ignore */ `${pathToFileURL(handlerPath).href}?v=${stat.mtimeMs}`);
      const fn = typeof mod.run === "function" ? mod.run : mod.default;
      if (typeof fn !== "function") {
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "handler does not export run/default",
        });
        continue;
      }
      tools[manifest.id] = fn as ToolImplementFn;
      catalog[manifest.id] = manifest;
    } catch (err) {
      await logDebugEvent("capability_tool_error", {
        folder: entry.name,
        error: errorMessage(err),
      });
    }
    }
  }
  capabilityToolsCache = tools;
  capabilityToolCatalogCache = catalog;
  return { tools, catalog };
}

export async function loadTools(): Promise<Record<string, ToolImplementFn>> {
  if (toolsCache) return toolsCache;
  const { tools: capabilityTools } = await loadCapabilityTools();

  // Extract functions from BUILTIN_TOOLS (which have { fn, emoji, description, ... } structure)
  const builtinFunctions: Record<string, ToolImplementFn> = Object.fromEntries(
    Object.entries(BUILTIN_TOOLS).map(([name, entry]) => [
      name,
      (typeof entry === "function" ? entry : entry.fn) as ToolImplementFn,
    ])
  );

  toolsCache = { ...builtinFunctions, ...capabilityTools };
  return toolsCache;
}

export function reloadToolCapabilitiesForTest() {
  capabilityToolsCache = null;
  capabilityToolCatalogCache = null;
  toolsCache = null;
}

export async function getToolNamesAsync() {
  return Object.keys(await loadTools());
}

export async function loadToolCatalog() {
  const { catalog: capabilityCatalog } = await loadCapabilityTools();
  const builtinCatalog = Object.fromEntries(
    Object.entries(BUILTIN_TOOLS).flatMap(([name, entry]) => {
      if (typeof entry === "function") return [];
      return [[
        name,
        {
          emoji: entry.emoji,
          description: entry.description,
          inputSchema: entry.inputSchema as Record<string, unknown>,
          ...(entry.requiresConfirmation !== undefined ? { requiresConfirmation: entry.requiresConfirmation } : {}),
          ...(entry.approvalSummary !== undefined ? { approvalSummary: entry.approvalSummary } : {}),
        },
      ]];
    })
  );
  return { ...builtinCatalog, ...capabilityCatalog };
}

export async function buildToolSpec(toolCatalog) {
  const tools = await loadTools();
  return Object.keys(tools)
    .map((name) => {
      const meta = toolCatalog?.[name];
      if (meta?.emoji && meta?.description) {
        const emoji = String(meta.emoji).replace(
          /([\p{Extended_Pictographic}])\s+(\uFE0F)/gu,
          "$1$2"
        );
        return `- ${emoji} | ${name}: ${meta.description}`;
      }
      return `- ${name}: see tool schema in system instructions`;
    })
    .join("\n");
}

export async function buildOpenAiToolDefinitions(toolCatalog) {
  const tools = await loadTools();
  return Object.keys(tools).flatMap((name) => {
    const meta = toolCatalog?.[name] || null;
    const schema = resolveInputSchema(meta);
    if (!schema || typeof schema !== "object" || schema.type !== "object") return [];
    const description =
      String(meta?.description || "").trim() || `Invoke the ${name} tool.`;
    return [{
      type: "function",
      function: {
        name,
        description,
        parameters: schema,
      },
    }];
  });
}

function nextCallId(runId, index) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const prefix = runId ? String(runId) : "call";
  return `${prefix}_${stamp}_${rand}_${index}`;
}

async function writeToolStartTranscript(
  ctx: ToolExecutionContext,
  { name, argsPreview, argsPreviewTruncated }: ToolStartTranscriptEventInput,
  toolCatalog?: Record<string, { emoji?: string } | undefined>
) {
  const event = createToolStartTranscriptEvent({ name, argsPreview, argsPreviewTruncated });
  process.stdout.write(
    dim(`${formatToolStartTranscript({ ...event, toolCatalog })}\n`)
  );
  await emitTranscriptEvent(ctx, event, {
    tool: name,
    runId: ctx?.runId || null,
  });
}

async function writeToolResultTranscript(
  ctx: ToolExecutionContext,
  { name, status = "ok", error = "" }: ToolResultTranscriptEventInput,
  toolCatalog?: Record<string, { emoji?: string } | undefined>
) {
  const event = createToolResultTranscriptEvent({ name, status, error });
  const line = formatToolResultTranscript({ ...event, toolCatalog });
  const color = status === "error" ? red : status === "denied" ? dim : green;
  process.stdout.write(color(`${line}\n`));
  await emitTranscriptEvent(ctx, event, {
    tool: name,
    runId: ctx?.runId || null,
  });
}

function buildArgsPreview(args) {
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

type IncomingToolCall = { name?: string; arguments?: unknown };

type PreparedToolCall = {
  name: string;
  schema: Record<string, unknown>;
  args: Record<string, unknown>;
  argsPreview: string;
  argsPreviewTruncated: boolean;
  ctx: ToolExecutionContext;
  callCtx: ToolExecutionContext & { callId: string };
  startedAt: number;
};

type FinishToolCallErrorOptions = {
  error?: string;
  resultError?: string;
  status?: string;
  resultExtra?: Record<string, unknown>;
  debugEvent?: string;
  debugExtra?: Record<string, unknown>;
  recordFailure?: boolean;
  skipErrorClassification?: boolean;
  httpStatus?: number | null;
};

function prepareToolCall({
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
  const name = typeof call?.name === "string" ? call.name : "";
  let rawArgs = call.arguments;
  if (typeof rawArgs === "string") {
    try {
      rawArgs = JSON.parse(rawArgs);
    } catch {
      rawArgs = {};
    }
  }
  rawArgs = hoistNestedToolArguments(name, rawArgs);

  if (name === "email") {
    rawArgs = inferEmailActionArgument(rawArgs);
  }

  let argsForNormalize = rawArgs;
  if (!argsForNormalize || typeof argsForNormalize !== "object" || Array.isArray(argsForNormalize)) {
    argsForNormalize = {};
  } else {
    argsForNormalize = applyPathArgAliases(name, { ...argsForNormalize });
    if (name === "write_file") {
      argsForNormalize = applyWriteFileBodyAliases(argsForNormalize);
    }
    if (name === "skill_bulk_save") {
      argsForNormalize = expandSkillBulkSaveArgs(argsForNormalize);
    }
  }

  const schema = resolveInputSchema(toolCatalog?.[name]);
  const args = normalizeToolArguments(argsForNormalize, schema);
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

async function announcePreparedToolCall(
  prepared: PreparedToolCall,
  toolCatalog: Record<string, { emoji?: string } | undefined>
) {
  await writeToolStartTranscript(
    prepared.ctx,
    {
      name: prepared.name,
      argsPreview: prepared.argsPreview,
      argsPreviewTruncated: prepared.argsPreviewTruncated,
    },
    toolCatalog
  );
  await logDebugEvent("tool_call_start", {
    tool: prepared.name,
    callId: prepared.callCtx.callId,
    runId: prepared.callCtx.runId || null,
    argumentsPreview: prepared.argsPreview,
  });
}

async function finishToolCallError(
  prepared: PreparedToolCall,
  results: Array<Record<string, unknown>>,
  toolCatalog: Record<string, { emoji?: string } | undefined>,
  opts: FinishToolCallErrorOptions = {}
) {
  const status = opts.status ?? "error";
  const rawError = opts.error ?? "";
  const resultError = opts.resultError ?? rawError;
  const resultExtra = opts.resultExtra ?? {};
  const debugEvent = opts.debugEvent ?? "tool_call_error";
  const debugExtra = opts.debugExtra ?? {};
  const recordFailure = opts.recordFailure !== false;

  let classification: Record<string, unknown> = {};
  if (!opts.skipErrorClassification) {
    const hintStatus =
      typeof opts.httpStatus === "number" && Number.isFinite(opts.httpStatus) ? opts.httpStatus : null;
    const c = classifyToolError(String(rawError || resultError || "error"), hintStatus);
    classification = {
      error_code: c.error_code,
      recovery_hint: c.recovery_hint,
      retryable: c.retryable,
      fail_reason: c.reason,
    };
  }

  results.push({
    tool: prepared.name,
    error: resultError,
    ...classification,
    ...resultExtra,
  });
  await writeToolResultTranscript(
    prepared.ctx,
    {
      name: prepared.name,
      status,
      error: status === "error" ? rawError : "",
    },
    toolCatalog
  );
  if (recordFailure) await recordToolFailure(prepared.name).catch(() => {});
  await logDebugEvent(debugEvent, {
    tool: prepared.name,
    callId: prepared.callCtx.callId,
    durationMs: Date.now() - prepared.startedAt,
    error: rawError || resultError,
    ...debugExtra,
  });
}

async function finishToolCallSuccess(
  prepared: PreparedToolCall,
  results: Array<Record<string, unknown>>,
  toolCatalog: Record<string, { emoji?: string } | undefined>,
  out: unknown
) {
  results.push({ tool: prepared.name, result: out });
  await writeToolResultTranscript(
    prepared.ctx,
    { name: prepared.name, status: "ok" },
    toolCatalog
  );
  await recordToolSuccess(prepared.name).catch(() => {});
  await logDebugEvent("tool_call_success", {
    tool: prepared.name,
    callId: prepared.callCtx.callId,
    durationMs: Date.now() - prepared.startedAt,
    resultType: typeof out,
  });
}

async function gatePreparedToolCall(
  prepared: PreparedToolCall,
  toolCatalog: Record<string, unknown>
) {
  const raw = toolCatalog?.[prepared.name];
  const toolEntry =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { approvalSummary?: string; requiresConfirmation?: boolean })
      : undefined;
  const summary = summarizeToolApproval(prepared.name, prepared.args, toolEntry?.approvalSummary);
  const risky = Boolean(toolEntry?.requiresConfirmation);
  return gateToolExecution({
    ctx: prepared.callCtx,
    toolLabel: prepared.name,
    summary,
    args: prepared.args,
    risky,
  });
}

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  fn: ToolImplementFn,
  toolCatalog: Record<string, { emoji?: string } | undefined>,
  results: Array<Record<string, unknown>>
) {
  try {
    const out = await Promise.resolve().then(() => fn(prepared.args, prepared.callCtx));
    await finishToolCallSuccess(prepared, results, toolCatalog, out);
  } catch (e) {
    let error = errorMessage(e);
    if (error.includes("Received undefined")) {
      error = `${error} (tool arguments missing or malformed)`;
    }
    const aborted =
      e?.name === "AbortError" ||
      prepared.ctx?.signal?.aborted ||
      /aborted|cancell?ed/i.test(error);
    await finishToolCallError(prepared, results, toolCatalog, {
      error,
      resultExtra: aborted ? { aborted: true } : {},
      debugExtra: { aborted: !!aborted },
    });
  }
}

/** Read-only tools safe to run concurrently (Hermes _PARALLEL_SAFE_TOOLS subset). */
export const PARALLEL_SAFE_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "grep",
  "read_file",
  "list_dir",
  "find_files",
  "skill_view",
  "wiki_search",
]);

const MAX_PARALLEL_TOOLS = 6;

export function shouldParallelizeToolBatch(
  prepared: Array<{ name: string }>
): boolean {
  if (prepared.length <= 1) return false;
  return prepared.every((p) => PARALLEL_SAFE_TOOLS.has(p.name));
}

async function runOnePreparedTool(
  prepared: PreparedToolCall,
  toolMap: Record<string, ToolImplementFn>,
  toolCatalog: Record<string, unknown>,
  results: Array<Record<string, unknown>>
) {
  if (prepared.ctx?.signal?.aborted) {
    await finishToolCallError(prepared, results, toolCatalog, {
      error: "aborted",
      resultExtra: { aborted: true },
      debugEvent: "tool_call_aborted",
      debugExtra: {
        runId: prepared.ctx.runId || null,
        reason: prepared.ctx.signal.reason ? String(prepared.ctx.signal.reason) : "aborted",
      },
    });
    return;
  }

  const fn = toolMap[prepared.name];
  if (!fn) {
    await finishToolCallError(prepared, results, toolCatalog, { error: "unknown tool" });
    return;
  }

  const missingRequiredError = validateRequiredArguments(
    prepared.name,
    prepared.args,
    prepared.schema
  );
  if (missingRequiredError) {
    await finishToolCallError(prepared, results, toolCatalog, {
      error: missingRequiredError,
      resultExtra: {
        error_code: "invalid_arguments",
        missing_required: true,
      },
      debugExtra: { errorCode: "invalid_arguments" },
    });
    return;
  }

  try {
    const allowed = await gatePreparedToolCall(prepared, toolCatalog);
    if (!allowed) {
      await finishToolCallError(prepared, results, toolCatalog, {
        error: "user_denied",
        status: "denied",
        resultExtra: { denied: true },
        debugEvent: "tool_call_denied",
      });
      return;
    }
  } catch (gateErr) {
    await finishToolCallError(prepared, results, toolCatalog, { error: errorMessage(gateErr) });
    return;
  }

  await executePreparedToolCall(prepared, fn, toolCatalog, results);
}

/**
 * Execute tool calls; batches of read-only safe tools run concurrently (cap 6).
 */
export async function runTools(
  toolCalls: unknown,
  ctx: ToolExecutionContext = createToolContext(),
  toolCatalog: Record<string, unknown> = {}
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  const toolMap = await loadTools();
  if (!Array.isArray(toolCalls)) {
    return results;
  }

  const preparedList = toolCalls.map((call, index) =>
    prepareToolCall({
      call: call as IncomingToolCall,
      ctx,
      toolCatalog,
      index,
    })
  );

  if (shouldParallelizeToolBatch(preparedList)) {
    for (const prepared of preparedList) {
      await announcePreparedToolCall(prepared, toolCatalog);
    }
    for (let i = 0; i < preparedList.length; i += MAX_PARALLEL_TOOLS) {
      const chunk = preparedList.slice(i, i + MAX_PARALLEL_TOOLS);
      const chunkOut: Array<Array<Record<string, unknown>>> = await Promise.all(
        chunk.map(async (prepared) => {
          const slot: Array<Record<string, unknown>> = [];
          await runOnePreparedTool(prepared, toolMap, toolCatalog, slot);
          return slot;
        })
      );
      for (const slot of chunkOut) {
        if (slot[0]) results.push(slot[0]);
      }
    }
    return results;
  }

  for (const prepared of preparedList) {
    await announcePreparedToolCall(prepared, toolCatalog);
    await runOnePreparedTool(prepared, toolMap, toolCatalog, results);
  }
  return results;
}
