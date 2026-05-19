import type { TurnJudgeRequest } from "./types.js";

export function serializeJudgeInput(input: TurnJudgeRequest): string {
  const lastMessages = input.messages.slice(-3);
  return [
    "TASK: Decide whether Web Agent should continue, stop, or ask the user.",
    "",
    "MESSAGES:",
    ...lastMessages.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 1500)}`),
    "",
    "TOOL_STATE:",
    JSON.stringify(input.toolState),
    "",
    "RUNTIME_STATE:",
    JSON.stringify(input.runtimeState),
  ].join("\n");
}
