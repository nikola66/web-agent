/**
 * Per-call execution context for tools — inspired by opencrabs'
 * `ToolExecutionContext` and sst/opencode's tool `Context`.
 *
 * A ToolContext bundles the runtime state every tool needs (cwd, abort
 * signal, timeout, env, services, ask callback, identifiers) so tools no
 * longer reach into module-level globals. The context is frozen once
 * constructed; "child" contexts (e.g. with a tighter timeout or a
 * different callId) are produced by the helpers below.
 */

import { WS } from "../constants.js";

const DEFAULT_TIMEOUT_MS = 120_000;

function neverAbortedSignal() {
  return new AbortController().signal;
}

function asAbortSignal(maybeSignal) {
  if (maybeSignal && typeof maybeSignal === "object" && typeof maybeSignal.aborted === "boolean") {
    return maybeSignal;
  }
  return neverAbortedSignal();
}

export type CreateToolContextInput = {
  sessionId?: string | null;
  runId?: string | null;
  callId?: string | null;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  profile?: Record<string, unknown> | null;
  services?: Record<string, unknown>;
  ask?: Function | null;
  autoApprove?: boolean;
  onTranscript?: Function | null;
};

/**
 * Build a per-call ToolContext. All fields are optional — callers should
 * supply at least `signal`, `cwd`, and any services their tools depend on.
 */
export function createToolContext({
  sessionId = null,
  runId = null,
  callId = null,
  cwd = WS,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  profile = null,
  services = {},
  ask = null,
  autoApprove = true,
  onTranscript = null,
}: CreateToolContextInput = {}) {
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  return Object.freeze({
    sessionId,
    runId,
    callId,
    cwd,
    signal: asAbortSignal(signal),
    timeoutMs: safeTimeout,
    env,
    profile,
    services,
    ask,
    autoApprove,
    onTranscript,
  });
}

/**
 * Derive a child context with a different callId. Used by the registry to
 * stamp each tool invocation inside a turn with a unique id without
 * mutating the parent context.
 */
export function withCallId(ctx, callId) {
  return Object.freeze({ ...ctx, callId });
}

/**
 * Combine the context's signal with an additional AbortSignal. Returns a
 * new context whose `signal` aborts as soon as either input aborts.
 *
 * Uses `AbortSignal.any` when available (Node 20.3+) and falls back to a
 * manual controller for older runtimes.
 */
export function linkSignal(ctx, extraSignal) {
  const extra = asAbortSignal(extraSignal);
  const parent = ctx.signal || neverAbortedSignal();
  if (extra === parent) return ctx;

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return Object.freeze({ ...ctx, signal: AbortSignal.any([parent, extra]) });
  }

  const controller = new AbortController();
  const abort = (reason) => {
    if (controller.signal.aborted) return;
    try {
      controller.abort(reason);
    } catch {
      controller.abort();
    }
  };
  if (parent.aborted) abort(parent.reason);
  else parent.addEventListener?.("abort", () => abort(parent.reason), { once: true });
  if (extra.aborted) abort(extra.reason);
  else extra.addEventListener?.("abort", () => abort(extra.reason), { once: true });

  return Object.freeze({ ...ctx, signal: controller.signal });
}

/**
 * Convenience: build a controller scoped by the context's `timeoutMs` and
 * pre-linked to `ctx.signal`. Caller is responsible for clearing the
 * timer in a `finally` block via the returned `cleanup`.
 */
export function createTimeoutController(ctx) {
  const controller = new AbortController();
  const linked = linkSignal({ signal: controller.signal, timeoutMs: ctx.timeoutMs }, ctx.signal);
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new Error(`tool timed out after ${ctx.timeoutMs}ms`));
  }, ctx.timeoutMs);
  return {
    signal: linked.signal,
    cleanup: () => clearTimeout(timer),
  };
}
