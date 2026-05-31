/** Hermes-style tool-use and execution guidance (ported from hermes-agent prompt_builder.py). */

import { isBigPickleModel, type LlmCfgLike } from "./llm/model-quirks.js";

export const TOOL_USE_ENFORCEMENT_GUIDANCE =
  "# Tool-use enforcement\n" +
  "You MUST use your tools to take action — do not describe what you would do " +
  "or plan to do without actually doing it. When you say you will perform an " +
  "action (e.g. 'I will run the tests', 'Let me check the file', 'I will create " +
  "the project'), you MUST immediately make the corresponding tool call in the same " +
  "response. Never end your turn with a promise of future action — execute it now.\n" +
  "Keep working until the task is actually complete. Do not stop with a summary of " +
  "what you plan to do next time. If you have tools available that can accomplish " +
  "the task, use them instead of telling the user what you would do.\n" +
  "Every response should either (a) contain tool calls that make progress, or " +
  "(b) deliver a final result to the user. Responses that only describe intentions " +
  "without acting are not acceptable.";

export const OPENAI_MODEL_EXECUTION_GUIDANCE =
  "# Execution discipline\n" +
  "<tool_persistence>\n" +
  "- Use tools whenever they improve correctness, completeness, or grounding.\n" +
  "- Do not stop early when another tool call would materially improve the result.\n" +
  "- If a tool returns empty or partial results, retry with a different query or " +
  "strategy before giving up.\n" +
  "- Keep calling tools until: (1) the task is complete, AND (2) you have verified " +
  "the result.\n" +
  "</tool_persistence>\n" +
  "\n" +
  "<mandatory_tool_use>\n" +
  "NEVER answer these from memory or mental computation — ALWAYS use a tool:\n" +
  "- Arithmetic, hashes, encodings, and checksums → use `run_python` for Python stdlib, or `run_shell` with `node -e` when dependency-free; otherwise explain browser limits\n" +
  "- Current time, date, timezone → use `system_info`\n" +
  "- System state: OS, CPU, memory, disk → use `system_info`; browser-only mode cannot inspect host ports/processes\n" +
  "- File contents, sizes, line counts → use read_file, grep, browse_workspace, or a `node ...` script\n" +
  "- Git history, branches, diffs → use file tools on available workspace files; browser-only mode has no git binary\n" +
  "- Current facts (weather, news, versions) → use web_search\n" +
  "</mandatory_tool_use>\n" +
  "\n" +
  "<act_dont_ask>\n" +
  "When a question has an obvious default interpretation, act on it immediately " +
  "instead of asking for clarification.\n" +
  "Only ask for clarification when the ambiguity genuinely changes what tool " +
  "you would call.\n" +
  "</act_dont_ask>\n" +
  "\n" +
  "<prerequisite_checks>\n" +
  "- Before taking an action, check whether prerequisite discovery, lookup, or " +
  "context-gathering steps are needed.\n" +
  "- Do not skip prerequisite steps just because the final action seems obvious.\n" +
  "</prerequisite_checks>\n" +
  "\n" +
  "<verification>\n" +
  "Before finalizing your response:\n" +
  "- Correctness: does the output satisfy every stated requirement?\n" +
  "- Grounding: are factual claims backed by tool outputs or provided context?\n" +
  "- Safety: if the next step has side effects (file writes, commands, API calls), " +
  "confirm scope before executing — ask the user first when approval is required.\n" +
  "</verification>\n" +
  "\n" +
  "<missing_context>\n" +
  "- If required context is missing, do NOT guess or hallucinate an answer.\n" +
  "- Use the appropriate lookup tool when missing information is retrievable " +
  "(memory_search, memory_recall, session_search, session_memory_list, web_search, read_file, etc.).\n" +
  "- Ask a clarifying question only when the information cannot be retrieved by tools.\n" +
  "- When you ask the user for input, stop — do not call tools in the same response.\n" +
  "</missing_context>";

const ENFORCEMENT_MODEL_HINTS = ["gpt", "codex", "gemini", "gemma", "grok", "glm", "qwen", "deepseek"];

export const BIG_PICKLE_TOOL_CALL_GUIDANCE =
  "# Big Pickle tool-call discipline\n" +
  "Emit native tool_calls with valid JSON arguments — never bare tool names, DSML/XML tags, or markdown fences.\n" +
  "Each tool call must include every required schema field in one object (flat keys or under `arguments`).\n" +
  "write_file example: {\"path\":\"projects/<slug>/article.md\",\"content\":\"# Title\\n\\n...\"}. " +
  "For long bodies: first write_file without append, then write_file with \"append\":true for later sections.\n" +
  "Never call write_file with {} or without both path and content.\n" +
  "When the user asks to share/show/send the file or document, call artifact_present with the workspace path — " +
  "do not paste the full body in chat and do not call read_file again.\n" +
  "Do not rewrite the same file from scratch unless the user asked for a full rewrite — use append:true or edit_file.";

export function buildExecutionGuidanceBlock(
  cfgOrModelId: LlmCfgLike | string | null | undefined
): string {
  const cfg: LlmCfgLike | null =
    cfgOrModelId && typeof cfgOrModelId === "object" ? cfgOrModelId : null;
  const modelId = cfg ? cfg.model : cfgOrModelId;
  const model = String(modelId || "").toLowerCase();
  const extended =
    ENFORCEMENT_MODEL_HINTS.some((hint) => model.includes(hint)) || isBigPickleModel(cfg ?? { model });
  let block = extended
    ? `${TOOL_USE_ENFORCEMENT_GUIDANCE}\n\n${OPENAI_MODEL_EXECUTION_GUIDANCE}`
    : TOOL_USE_ENFORCEMENT_GUIDANCE;
  if (isBigPickleModel(cfg ?? { model: modelId })) {
    block += `\n\n${BIG_PICKLE_TOOL_CALL_GUIDANCE}`;
  }
  return block;
}
