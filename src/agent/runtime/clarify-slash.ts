/** Synthetic user message for `/clarify` turns (UI shows raw `/clarify …`). */
export function buildClarifyModeUserPrompt(topic: string) {
  const topicText =
    String(topic || "").trim() ||
    "Infer what needs clarifying from the recent conversation and the latest user message.";
  return [
    "The user invoked **clarify mode** via `/clarify`. Follow it strictly for this turn only.",
    "",
    `**Topic:** ${topicText}`,
    "",
    "Emit exactly one host marker block — **no tool calls** this turn:",
    "",
    "<<<CLARIFY>>>",
    '{"question":"Your one-sentence question?","options":["Option A","Option B"],"open_ended":false}',
    "<<<END>>>",
    "",
    "Rules: valid JSON; 2–6 short `options` when `open_ended` is false; stop after the block; host shows buttons.",
  ].join("\n");
}
