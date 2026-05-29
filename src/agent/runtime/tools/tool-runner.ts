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
import { createToolContext } from "./context.js";
import type { ToolImplementFn } from "./definition.js";
import { validateRequiredArguments } from "./argument-normalization.js";
import { gateToolExecution, summarizeToolApproval } from "./tool-policy.js";
import { classifyToolError } from "./error-classifier.js";
import { loadTools } from "./tool-loader.js";
import {
  prepareToolCall,
  type PreparedToolCall,
  type ToolExecutionContext,
} from "./tool-prep.js";

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

async function writeToolStartTranscript(
  ctx: ToolExecutionContext,
  { name, argsPreview, argsPreviewTruncated }: ToolStartTranscriptEventInput,
  toolCatalog?: Record<string, { emoji?: string } | undefined>
) {
  const event = createToolStartTranscriptEvent({ name, argsPreview, argsPreviewTruncated });
  if (!ctx?.skipTerminalOutput) {
    process.stdout.write(
      dim(`${formatToolStartTranscript({ ...event, toolCatalog })}\n`)
    );
  }
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
  if (!ctx?.skipTerminalOutput) {
    process.stdout.write(color(`${line}\n`));
  }
  await emitTranscriptEvent(ctx, event, {
    tool: name,
    runId: ctx?.runId || null,
  });
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

export async function gatePreparedToolCall(
  prepared: PreparedToolCall,
  toolCatalog: Record<string, unknown>
) {
  const raw = toolCatalog?.[prepared.name];
  const toolEntry =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { approvalSummary?: string; requiresConfirmation?: boolean; emoji?: string })
      : undefined;
  const baseName = prepared.name.includes(":") ? prepared.name.split(":")[0] : prepared.name;
  const baseRaw = toolCatalog?.[baseName];
  const baseEntry =
    baseRaw && typeof baseRaw === "object" && !Array.isArray(baseRaw)
      ? (baseRaw as { emoji?: string })
      : undefined;
  const summary = summarizeToolApproval(prepared.name, prepared.args, toolEntry?.approvalSummary);
  const action =
    prepared.args && typeof prepared.args === "object" && !Array.isArray(prepared.args)
      ? String((prepared.args as Record<string, unknown>).action || "").trim()
      : "";
  const manageAction =
    prepared.args && typeof prepared.args === "object" && !Array.isArray(prepared.args)
      ? String(
          (prepared.args as Record<string, unknown>).manage_action ||
            (prepared.args as Record<string, unknown>).operation ||
            ""
        ).trim()
      : "";
  const risky =
    Boolean(toolEntry?.requiresConfirmation) ||
    (prepared.name === "skill" && action === "bulk") ||
    (prepared.name === "skill" && action === "manage" && manageAction === "delete");
  return gateToolExecution({
    ctx: prepared.callCtx,
    toolLabel: prepared.name,
    summary,
    args: prepared.args,
    risky,
    toolEmoji: toolEntry?.emoji || baseEntry?.emoji,
  });
}

export async function executePreparedToolCall(
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
    // Preserve structured fields a thrown error carries (e.g. HTTP failures
    // attach recovery_hint / parsed error data / status / suggested_tool).
    // Without this they collapse to the bare message and the classifier has to
    // re-derive a hint it cannot reconstruct (e.g. the GraphQL relation hint,
    // which needs the response body).
    const extra: Record<string, unknown> = aborted ? { aborted: true } : {};
    if (e && typeof e === "object") {
      for (const key of ["recovery_hint", "data", "status", "suggested_tool"] as const) {
        const val = (e as Record<string, unknown>)[key];
        if (val !== undefined && extra[key] === undefined) extra[key] = val;
      }
    }
    await finishToolCallError(prepared, results, toolCatalog, {
      error,
      resultExtra: extra,
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
  "browse_workspace",
  "list_dir",
  "find_files",
  "wiki_search",
]);

const MAX_PARALLEL_TOOLS = 6;

export function isParallelSafeToolCall(name: string, args: Record<string, unknown> = {}): boolean {
  const tool = String(name || "").trim();
  if (tool === "skill") {
    const action = String(args.action || "").trim().toLowerCase();
    return action === "list" || action === "view";
  }
  return PARALLEL_SAFE_TOOLS.has(tool);
}

export function shouldParallelizeToolBatch(
  prepared: Array<{ name: string; args?: Record<string, unknown> }>
): boolean {
  if (prepared.length <= 1) return false;
  return prepared.every((p) => isParallelSafeToolCall(p.name, p.args || {}));
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
      call: call as { name?: string; arguments?: unknown },
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
