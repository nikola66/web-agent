/** Provider/model-specific LLM request and stream behavior (OpenCode Big Pickle, etc.). */

export type LlmCfgLike = {
  provider?: string;
  model?: string;
};

const DEFAULT_STREAM_MAX_TOKENS = 8192;
/** Matches OpenCode ProviderTransform.OUTPUT_TOKEN_MAX for long-output models. */
const BIG_PICKLE_STREAM_MAX_TOKENS = 32_000;

export function isOpencodeBigPickle(cfg: LlmCfgLike | null | undefined): boolean {
  return (
    String(cfg?.provider || "").toLowerCase() === "opencode" &&
    String(cfg?.model || "").toLowerCase() === "big-pickle"
  );
}

/** OpenCode Big Pickle or any provider routing a big-pickle model id. */
export function isBigPickleModel(cfg: LlmCfgLike | null | undefined): boolean {
  if (isOpencodeBigPickle(cfg)) return true;
  const model = String(cfg?.model || "").toLowerCase();
  return model.includes("big-pickle") || model.includes("big_pickle");
}

export function resolveStreamMaxTokens(cfg: LlmCfgLike | null | undefined): number {
  if (isBigPickleModel(cfg)) return BIG_PICKLE_STREAM_MAX_TOKENS;
  return DEFAULT_STREAM_MAX_TOKENS;
}

/** Big Pickle emits interleaved reasoning_content; preview can duplicate visible answer prefixes. */
export function reasoningPreviewSupportedForModel(cfg: LlmCfgLike | null | undefined): boolean {
  if (!isBigPickleModel(cfg)) return true;
  return String(process.env.WEBAGENT_OPENCODE_REASONING_PREVIEW ?? "0").trim() === "1";
}
