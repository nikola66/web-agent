import { ipcProxyRequest } from "./ipc.js";

export type TurnJudgeAction = "continue" | "stop" | "ask_user";

export type TurnJudgeDecision = {
  action: TurnJudgeAction;
  confidence: number;
  reason: string;
  source: "model" | "fallback" | "safety" | "disabled" | "error";
  latencyMs?: number;
};

export const TURN_JUDGE_DEFAULT_URL = "http://127.0.0.1:8787/judge";

function envBool(name: string): boolean {
  const v = String(
    typeof process !== "undefined" ? (process.env?.[name] ?? "") : ""
  )
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function envOff(name: string): boolean {
  const v = String(
    typeof process !== "undefined" ? (process.env?.[name] ?? "") : ""
  )
    .trim()
    .toLowerCase();
  return v === "0" || v === "false" || v === "off" || v === "no";
}

export function resolveTurnJudgeUrl(): string {
  const raw = String(
    typeof process !== "undefined" ? (process.env?.TURN_JUDGE_URL ?? "") : ""
  ).trim();
  if (raw) return raw;
  const origin = String(
    typeof process !== "undefined" ? (process.env?.WEBAGENT_APP_ORIGIN ?? "") : ""
  ).trim();
  if (origin) return `${origin.replace(/\/$/, "")}/api/turn-judge`;
  return TURN_JUDGE_DEFAULT_URL;
}

/** Turn judge is on by default; set WEBAGENT_TURN_JUDGE=0 to disable. */
export function isTurnJudgeEnabled(): boolean {
  return !envOff("WEBAGENT_TURN_JUDGE");
}

export function resolveTurnJudgeRuntimeFlags() {
  const url = resolveTurnJudgeUrl();
  const enabled = isTurnJudgeEnabled();
  return {
    url,
    enabled,
    shadowOnly: envBool("WEBAGENT_TURN_JUDGE_SHADOW") && !enabled,
  };
}

function useIpcJudgeBridge(): boolean {
  return String(process.env?.WEBAGENT_RUNTIME ?? "").toLowerCase() === "nodebox";
}

async function postJudgeJson(
  url: string,
  payload: unknown,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload);
  if (useIpcJudgeBridge()) {
    if (signal?.aborted) throw new Error("aborted");
    const raw = (await ipcProxyRequest({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      body,
    })) as { error?: string; status?: number; body?: string };
    if (raw?.error) throw new Error(String(raw.error));
    const st = Number(raw.status);
    if (!Number.isFinite(st) || st < 200 || st >= 300) {
      throw new Error(`turn_judge_http_${st}`);
    }
    return JSON.parse(String(raw.body ?? "{}")) as Record<string, unknown>;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`turn_judge_http_${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

function mergeAbortSignals(outer: AbortSignal | undefined, ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("turn_judge_timeout"));
  }, ms);
  const onOuterAbort = () => {
    try {
      controller.abort(outer!.reason);
    } catch {
      controller.abort();
    }
  };
  if (outer) {
    if (outer.aborted) onOuterAbort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (outer) outer.removeEventListener("abort", onOuterAbort);
    },
  };
}

export async function judgeTurnState(
  payload: unknown,
  outerSignal?: AbortSignal,
  timeoutMs = useIpcJudgeBridge() ? 3000 : 500
): Promise<TurnJudgeDecision> {
  const enabled = isTurnJudgeEnabled();
  const url = resolveTurnJudgeUrl();

  if (!enabled) {
    return {
      action: "stop",
      confidence: 0,
      reason: "turn_judge_disabled",
      source: "disabled",
    };
  }

  const { signal, cleanup } = mergeAbortSignals(outerSignal, timeoutMs);
  try {
    const data = await postJudgeJson(url, payload, useIpcJudgeBridge() ? undefined : signal);

    if (!["continue", "stop", "ask_user"].includes(String(data.action))) {
      throw new Error("bad_turn_judge_action");
    }

    const src = String(data.source || "model");
    const normalizedSource =
      src === "safety" || src === "fallback" || src === "model" ? src : "model";

    return {
      action: data.action as TurnJudgeAction,
      confidence: Number(data.confidence ?? 0),
      reason: String(data.reason ?? "model_decision"),
      source: normalizedSource as TurnJudgeDecision["source"],
      latencyMs: Number(data.latencyMs ?? 0),
    };
  } catch {
    return {
      action: "stop",
      confidence: 0,
      reason: "turn_judge_unavailable",
      source: "error",
    };
  } finally {
    cleanup();
  }
}

export async function fetchTurnJudgeDecisionForShadow(
  payload: unknown,
  outerSignal?: AbortSignal,
  timeoutMs = useIpcJudgeBridge() ? 3000 : 500
): Promise<TurnJudgeDecision | null> {
  const { shadowOnly, url } = resolveTurnJudgeRuntimeFlags();
  if (!shadowOnly) return null;
  const { signal, cleanup } = mergeAbortSignals(outerSignal, timeoutMs);
  try {
    const data = await postJudgeJson(url, payload, useIpcJudgeBridge() ? undefined : signal);
    if (!["continue", "stop", "ask_user"].includes(String(data.action))) return null;
    return {
      action: data.action as TurnJudgeAction,
      confidence: Number(data.confidence ?? 0),
      reason: String(data.reason ?? "shadow"),
      source: "model",
      latencyMs: Number(data.latencyMs ?? 0),
    };
  } catch {
    return null;
  } finally {
    cleanup();
  }
}
