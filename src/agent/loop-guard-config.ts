import { LOOP_GUARD_DEFAULTS, type LoopGuardThresholds } from "./supervisor/thresholds.js";

type EnvLike = Record<string, string | undefined>;

function envString(env: EnvLike, viteKey: string, fallback: string): string {
  const raw = String(env[viteKey] ?? "").trim();
  return raw || fallback;
}

function envNum(env: EnvLike, viteKey: string, fallback: number): number {
  const raw = String(env[viteKey] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function isLoopGuardEnabledFromEnv(env: EnvLike): boolean {
  const raw = envString(env, "VITE_WEBAGENT_LOOP_GUARD", "1").toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function readLoopGuardThresholds(env: EnvLike): LoopGuardThresholds {
  return {
    maxMessages: Math.max(1, Math.min(20, envNum(env, "VITE_WEBAGENT_LOOP_GUARD_MAX_MESSAGES", LOOP_GUARD_DEFAULTS.maxMessages))),
    stopThreshold: envNum(env, "VITE_WEBAGENT_LOOP_GUARD_STOP_THRESHOLD", LOOP_GUARD_DEFAULTS.stopThreshold),
    askUserThreshold: envNum(
      env,
      "VITE_WEBAGENT_LOOP_GUARD_ASK_USER_THRESHOLD",
      LOOP_GUARD_DEFAULTS.askUserThreshold
    ),
    continueThreshold: envNum(
      env,
      "VITE_WEBAGENT_LOOP_GUARD_CONTINUE_THRESHOLD",
      LOOP_GUARD_DEFAULTS.continueThreshold
    ),
    fallbackDecision: LOOP_GUARD_DEFAULTS.fallbackDecision,
  };
}

/** Maps Vite env into `WEBAGENT_*` keys for the Nodebox runtime. */
export function loopGuardEnvForRuntime(env: EnvLike): Record<string, string> {
  return {
    WEBAGENT_LOOP_GUARD: envString(env, "VITE_WEBAGENT_LOOP_GUARD", "1"),
    WEBAGENT_MAX_AUTO_CONTINUE_NUDGES: envString(env, "VITE_WEBAGENT_MAX_AUTO_CONTINUE_NUDGES", "20"),
    WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES: envString(
      env,
      "VITE_WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES",
      "30"
    ),
  };
}
