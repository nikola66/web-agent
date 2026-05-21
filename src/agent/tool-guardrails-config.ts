type EnvLike = Record<string, string | undefined>;

export function toolGuardrailsEnvForRuntime(env: EnvLike): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = [
    "VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_WARNINGS",
    "VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_HARD_STOP",
    "VITE_WEBAGENT_TOOL_LOOP_EXACT_FAILURE_WARN_AFTER",
    "VITE_WEBAGENT_TOOL_LOOP_EXACT_FAILURE_BLOCK_AFTER",
    "VITE_WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_WARN_AFTER",
    "VITE_WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_HALT_AFTER",
    "VITE_WEBAGENT_TOOL_LOOP_NO_PROGRESS_WARN_AFTER",
    "VITE_WEBAGENT_TOOL_LOOP_NO_PROGRESS_BLOCK_AFTER",
  ] as const;

  for (const viteKey of keys) {
    const raw = env[viteKey];
    if (raw == null || String(raw).trim() === "") continue;
    out[viteKey.replace(/^VITE_/, "")] = String(raw).trim();
  }
  return out;
}
