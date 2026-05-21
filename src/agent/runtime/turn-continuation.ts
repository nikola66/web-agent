/**
 * Turn continuation recovery — ported from Hermes agent/agent_runtime_helpers.py
 * (looks_like_codex_intermediate_ack) and agent/conversation_loop.py (empty-after-tools nudge).
 */

export const MAX_INTERMEDIATE_ACK_CONTINUATIONS = 2;
export const MAX_EMPTY_AFTER_TOOLS_CONTINUATIONS = 1;
export const MAX_POST_TOOL_STALL_CONTINUATIONS = 1;
export const MAX_PRE_TOOL_PROMISE_CONTINUATIONS = 1;

export const SYNTHETIC_EMPTY_ASSISTANT_CONTENT = "(empty)";

/** English future/commitment phrases that announce imminent tool use (not final answers). */
const FUTURE_ACTION_INTENT_RES: RegExp[] = [
  /\bi['']?ll\b/i,
  /\bi will\b/i,
  /\bi['']?m going to\b/i,
  /\bi am going to\b/i,
  /\bi['']?m about to\b/i,
  /\bi am about to\b/i,
  /\bi['']?m ready to\b/i,
  /\bi am ready to\b/i,
  /\bi['']?m planning to\b/i,
  /\bi am planning to\b/i,
  /\bi['']?m preparing to\b/i,
  /\bi am preparing to\b/i,
  /\bi need to\b/i,
  /\bi have to\b/i,
  /\bi['']?ve got to\b/i,
  /\bi must\b/i,
  /\bi should\b/i,
  /\blet me\b/i,
  /\ballow me to\b/i,
  /\bgo ahead and\b/i,
  /\bi can do that\b/i,
  /\bi can help with that\b/i,
  /\bi['']?ll proceed\b/i,
  /\bi will proceed\b/i,
  /\bi['']?ll go ahead\b/i,
  /\bi['']?ll start\b/i,
  /\bi['']?ll begin\b/i,
  /\bi will start\b/i,
  /\bi will begin\b/i,
  /\bi['']?ll kick off\b/i,
  /\bi['']?ll dive\b/i,
  /\bi['']?ll work on\b/i,
  /\bi['']?ll continue\b/i,
  /\bi['']?ll take a\b/i,
  /\bi['']?ll pull\b/i,
  /\bi['']?ll fetch\b/i,
  /\bi['']?ll grab\b/i,
  /\bi['']?ll dig into\b/i,
  /\bi['']?ll dig through\b/i,
  /\bi['']?ll track down\b/i,
  /\bi['']?ll hunt\b/i,
  /\bi['']?ll now\b/i,
  /\bi['']?ll immediately\b/i,
  /\b(?:first|next|then|now|so),?\s+i['']?ll\b/i,
  /\b(?:first|next|then|now|so),?\s+i will\b/i,
  /\b(?:first|next|then|now|so),?\s+i['']?m going to\b/i,
  /\b(?:first|next|then|now|so),?\s+i am going to\b/i,
  /\b(?:first|next|then|now|so),?\s+let me\b/i,
];

export function matchesFutureActionIntent(text: string): boolean {
  const low = String(text || "").trim().toLowerCase();
  if (!low) return false;
  return FUTURE_ACTION_INTENT_RES.some((re) => re.test(low));
}

/** English patterns where the agent is asking the user to decide, choose, or supply info — do not nudge. */
const USER_INPUT_REQUEST_RES: RegExp[] = [
  /\bgive me\b/i,
  /\bplease provide\b/i,
  /\bplease send\b/i,
  /\bsend me\b/i,
  /\bshare (?:the|your|any)\b/i,
  /\bpaste (?:the|your)\b/i,
  /\bprovide (?:the|your|me with)\b/i,
  /\blist of domains\b/i,
  /\bneed (?:the|your|a list of)\b/i,
  /\bwaiting for (?:your|the)\b/i,
  /\blet me know\b/i,
  /\btell me (?:which|what|who|where|when|how|if|whether|your)\b/i,
  /\bshall i\b/i,
  /\bshould i\b/i,
  /\bmay i\b/i,
  /\bdo you want me to\b/i,
  /\bwould you like me to\b/i,
  /\bcan i proceed\b/i,
  /\bokay to proceed\b/i,
  /\bok to proceed\b/i,
  /\bneed your approval\b/i,
  /\bneed your confirmation\b/i,
  /\bneed your (?:input|help|guidance|decision|sign[- ]?off|preference|answer)\b/i,
  /\bawaiting your\b/i,
  /\bonce you (?:confirm|approve|decide|choose|pick|select|reply|respond|share|send)\b/i,
  /\bbefore i (?:start|begin|proceed|continue|search|run|execute|move forward)\b/i,
  /\blet me ask\b/i,
  /\bi (?:need|have) to ask\b/i,
  /\bi should ask\b/i,
  /\ba(?: couple)? of questions?\b/i,
  /\bquick question\b/i,
  /\bclarif(?:y|ication)\b/i,
  /\bneed (?:more|some|additional) (?:info|information|context|details)\b/i,
  /\bmissing (?:info|information|context|details)\b/i,
  /\bcould you (?:clarify|confirm|specify|tell|share|provide|send|choose|pick|decide|approve)\b/i,
  /\bcan you (?:clarify|confirm|specify|tell|share|provide|send|choose|pick|decide|approve)\b/i,
  /\bwould you (?:mind|prefer|like to|rather)\b/i,
  /\bwhat (?:do you|would you|should i|is your|are your)\b/i,
  /\bwhich (?:do you|would you|should i|one|option|approach|path|niche|variant)\b/i,
  /\bwho should\b/i,
  /\bwhere should i\b/i,
  /\bhow should i\b/i,
  /\bchoose (?:one|between|from|which|your)\b/i,
  /\bpick (?:one|between|from|which|your)\b/i,
  /\bselect (?:one|from|which|your|an option)\b/i,
  /\bwhich option\b/i,
  /\byour call\b/i,
  /\bup to you\b/i,
  /\bprefer (?:which|one|a or b)\b/i,
  /\bconfirm (?:if|whether|that|before|which)\b/i,
  /\bplease confirm\b/i,
  /\breply with\b/i,
  /\brespond with\b/i,
  /\bwhen you(?:'re| are) ready\b/i,
  /\bwhich (?:of these|would you like)\b/i,
  /\bdo you prefer\b/i,
  /\bwant me to wait\b/i,
  /\bhold on until\b/i,
  /\bpaused until you\b/i,
];

function endsWithUserDirectedQuestion(low: string): boolean {
  if (!/\?\s*$/.test(low)) return false;
  return /\b(you|your|we|us|which|what|who|where|when|how|prefer|choose|select|confirm|approve|proceed|okay|ok|should i|shall i|want me to|like me to|mind if|either|option)\b/i.test(
    low
  );
}

function hasChoicePromptNearEnd(low: string): boolean {
  const tail = low.slice(-500);
  if (!/\?/.test(tail)) return false;
  if (
    /\b(?:pick|choose|select|which (?:one|option|approach)|option [a-d1-9]|\d[\).:]\s)\b/i.test(
      tail
    )
  ) {
    return true;
  }
  return (
    /\beither .{1,120} or\b/i.test(tail) &&
    /\b(?:which|should|shall|prefer|would you|do you|your call|up to you)\b/i.test(tail)
  );
}

export function matchesUserInputRequest(text: string): boolean {
  const low = String(text || "").trim().toLowerCase();
  if (!low) return false;
  if (USER_INPUT_REQUEST_RES.some((re) => re.test(low))) return true;
  if (endsWithUserDirectedQuestion(low)) return true;
  if (hasChoicePromptNearEnd(low)) return true;
  return false;
}

/** English patterns for final answers, deliverables, blockers, or task wrap-up — do not nudge. */
const TASK_COMPLETION_RES: RegExp[] = [
  /\b(?:task|work|research|search|audit|run|lookup|hunt) (?:is )?(?:complete|completed|done|finished)\b/i,
  /\b(?:we're|we are|i'm|i am) (?:done|finished|all set|complete)\b/i,
  /\bhere(?:'s| is| are) (?:the |your |our )?(?:final |complete )?/i,
  /\bhere are \d+\b/i,
  /\bfinal (?:summary|report|list|result|answer|conclusion|recommendation|blocker|deliverable|shortlist|output)\b/i,
  /\b(?:in summary|to summarize|bottom line|in conclusion|wrapping up)\b/i,
  /\bthat completes\b/i,
  /\bthat should do it\b/i,
  /\ball set\b/i,
  /\bnothing (?:else )?(?:to do|needed|remaining|left to do)\b/i,
  /\bno further (?:action|steps|work|changes|updates)\b/i,
  /\b(?:unable|can't|cannot)(?: to)? proceed (?:further|without)\b/i,
  /\b(?:the |a )?blocker is\b/i,
  /\bfinal blocker\b/i,
  /\bhard blocker\b/i,
  /\bshowstopper\b/i,
  /\bstopping here\b/i,
  /\bout of scope\b/i,
  /\bdeliverable[s]?\s*(?:below|:)/i,
  /\bas requested\b/i,
  /\bmission accomplished\b/i,
  /\btask accomplished\b/i,
  /\bwork is complete\b/i,
  /\bthis completes the (?:task|request|work|phase|step)\b/i,
  /\bphase (?:is )?complete\b/i,
  /\bstep (?:is )?complete\b/i,
  /\bready for (?:your )?review\b/i,
  /\bhandoff complete\b/i,
  /\blet me know if (?:you(?:'d| would) like|you want|you need anything else|anything else)\b/i,
  /\bhappy to (?:help further|adjust|iterate|refine)\b/i,
  /\bfeel free to (?:ask|let me know)\b/i,
  /^done\b/im,
  /^finished\b/im,
  /^complete\b/im,
  /^completed\b/im,
];

function tailSentences(text: string, count = 3): string {
  const parts = String(text || "")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return String(text || "").trim().toLowerCase();
  return parts.slice(-count).join(" ").toLowerCase();
}

function hasDeliverablePresentationNearEnd(low: string): boolean {
  const tail = low.slice(-700);
  if (!/\b(?:here(?:'s| is| are)|below (?:is|are)|attached (?:is|are)|final list|target list|shortlist)\b/i.test(tail)) {
    return false;
  }
  return (
    /\b(?:are|is) (?:the|your|our)\b/i.test(tail) ||
    /\b\d+\s+(?:companies|domains|targets|results|contacts|entries|names|rows)\b/i.test(tail)
  );
}

export function matchesTaskCompletionOrFinalState(text: string): boolean {
  const low = String(text || "").trim().toLowerCase();
  if (!low) return false;
  if (TASK_COMPLETION_RES.some((re) => re.test(low))) return true;
  if (hasDeliverablePresentationNearEnd(low)) return true;
  return false;
}

function tailPromisesFurtherAction(text: string): boolean {
  const tail = tailSentences(text, 3);
  if (!matchesFutureActionIntent(tail)) return false;
  return ACTION_MARKERS.some((marker) => tail.includes(marker));
}

/** True when the turn should end — user ask, final deliverable, blocker, or wrap-up. */
export function shouldSuppressContinuationNudge(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (matchesUserInputRequest(raw)) return true;
  if (matchesTaskCompletionOrFinalState(raw) && !tailPromisesFurtherAction(raw)) return true;
  return false;
}

const ACTION_MARKERS = [
  "look into",
  "look at",
  "inspect",
  "scan",
  "check",
  "analyz",
  "review",
  "explore",
  "read",
  "open",
  "run",
  "test",
  "fix",
  "debug",
  "search",
  "find",
  "hunt",
  "research",
  "start",
  "begin",
  "pull",
  "fetch",
  "gather",
  "collect",
  "investigate",
  "verify",
  "validate",
  "compile",
  "build",
  "create",
  "draft",
  "query",
  "browse",
  "scrape",
  "parse",
  "install",
  "deploy",
  "execute",
  "continue",
  "walkthrough",
  "report back",
  "summarize",
] as const;

const WORKSPACE_MARKERS = [
  "directory",
  "current directory",
  "current dir",
  "cwd",
  "repo",
  "repository",
  "codebase",
  "project",
  "folder",
  "filesystem",
  "file tree",
  "files",
  "path",
] as const;

type ConvMsg = { role?: string; content?: unknown };

function isToolResultsUserMessage(content: unknown): boolean {
  return typeof content === "string" && content.startsWith("Tool results (compact JSON)");
}

/** Hermes: no intermediate-ack once tool results exist in the live conversation. */
export function hasToolContextInConversation(
  messages: ConvMsg[],
  executedToolsInTurn: boolean
): boolean {
  if (executedToolsInTurn) return true;
  return messages.some(
    (msg) => msg.role === "tool" || (msg.role === "user" && isToolResultsUserMessage(msg.content))
  );
}

/** Port of Hermes looks_like_codex_intermediate_ack (conversation_loop.py ~3687+). */
export function looksLikeCodexIntermediateAck(
  userMessage: string,
  assistantContent: string,
  messages: ConvMsg[],
  executedToolsInTurn: boolean
): boolean {
  if (hasToolContextInConversation(messages, executedToolsInTurn)) return false;

  const assistantText = String(assistantContent || "").trim().toLowerCase();
  if (!assistantText) return false;
  if (assistantText.length > 1200) return false;
  if (matchesUserInputRequest(assistantText)) return false;
  if (matchesTaskCompletionOrFinalState(assistantText) && !tailPromisesFurtherAction(assistantContent)) {
    return false;
  }
  if (!matchesFutureActionIntent(assistantText)) return false;

  const assistantMentionsAction = ACTION_MARKERS.some((marker) => assistantText.includes(marker));
  if (!assistantMentionsAction) return false;

  const userText = String(userMessage || "").trim().toLowerCase();
  const userTargetsWorkspace =
    WORKSPACE_MARKERS.some((marker) => userText.includes(marker)) ||
    userText.includes("~/") ||
    userText.includes("/");
  const assistantTargetsWorkspace = WORKSPACE_MARKERS.some((marker) =>
    assistantText.includes(marker)
  );
  return userTargetsWorkspace || assistantTargetsWorkspace;
}

/** @deprecated alias — use looksLikeCodexIntermediateAck */
export const looksLikeIntermediateAck = looksLikeCodexIntermediateAck;

export function looksLikeEmptyAfterTools(visible: string, executedToolsInTurn: boolean): boolean {
  if (!executedToolsInTurn) return false;
  return !String(visible || "").trim();
}

function looksLikeActionPromiseStall(visible: string): boolean {
  const text = String(visible || "").trim();
  if (!text) return false;
  const low = text.toLowerCase();
  if (low.length > 1200) return false;
  if (shouldSuppressContinuationNudge(text)) return false;
  if (!matchesFutureActionIntent(low)) return false;
  return ACTION_MARKERS.some((marker) => low.includes(marker));
}

/** After tools ran: promised next action in text but no follow-up tool calls (Hermes empty-nudge spirit). */
export function looksLikePostToolStall(visible: string, executedToolsInTurn: boolean): boolean {
  if (!executedToolsInTurn) return false;
  return looksLikeActionPromiseStall(visible);
}

/** Before any tools: promised action but no tool calls (research/outreach tasks without workspace paths). */
export function looksLikePreToolPromiseStall(
  visible: string,
  messages: ConvMsg[],
  executedToolsInTurn: boolean
): boolean {
  if (executedToolsInTurn) return false;
  if (hasToolContextInConversation(messages, executedToolsInTurn)) return false;
  return looksLikeActionPromiseStall(visible);
}

export type ContinuationNudgeKind =
  | "intermediate_ack"
  | "empty_after_tools"
  | "post_tool_stall"
  | "pre_tool_promise";

export function buildContinuationNudge(kind: ContinuationNudgeKind): string {
  if (kind === "empty_after_tools") {
    return (
      "You just executed tool calls but returned an empty response. " +
      "Please process the tool results above and continue with the task."
    );
  }
  if (kind === "post_tool_stall") {
    return (
      "You executed tool calls but ended with only a promise to take the next step. " +
      "Process the tool results above and continue now by calling the tools needed for that step."
    );
  }
  if (kind === "pre_tool_promise") {
    return (
      "You ended with only a promise to take the next step. " +
      "Continue now by calling the tools needed for that step."
    );
  }
  return (
    "[System: Continue now. Execute the required tool calls and only " +
    "send your final answer after completing the task.]"
  );
}

export function buildSyntheticEmptyAssistantMessage(): ConvMsg & { _empty_recovery_synthetic: true } {
  return {
    role: "assistant",
    content: SYNTHETIC_EMPTY_ASSISTANT_CONTENT,
    _empty_recovery_synthetic: true,
  };
}

export function buildEmptyRecoveryUserMessage(): ConvMsg & { _empty_recovery_synthetic: true } {
  return {
    role: "user",
    content: buildContinuationNudge("empty_after_tools"),
    _empty_recovery_synthetic: true,
  };
}

export function shouldContinueIntermediateAck(
  userMessage: string,
  assistantContent: string,
  messages: ConvMsg[],
  executedToolsInTurn: boolean,
  intermediateAckContinuations: number
): boolean {
  if (intermediateAckContinuations >= MAX_INTERMEDIATE_ACK_CONTINUATIONS) return false;
  return looksLikeCodexIntermediateAck(
    userMessage,
    assistantContent,
    messages,
    executedToolsInTurn
  );
}

export function shouldContinueEmptyAfterTools(
  visible: string,
  executedToolsInTurn: boolean,
  emptyAfterToolsContinuations: number
): boolean {
  if (emptyAfterToolsContinuations >= MAX_EMPTY_AFTER_TOOLS_CONTINUATIONS) return false;
  return looksLikeEmptyAfterTools(visible, executedToolsInTurn);
}

export function shouldContinuePostToolStall(
  visible: string,
  executedToolsInTurn: boolean,
  postToolStallContinuations: number
): boolean {
  if (postToolStallContinuations >= MAX_POST_TOOL_STALL_CONTINUATIONS) return false;
  return looksLikePostToolStall(visible, executedToolsInTurn);
}

export function shouldContinuePreToolPromiseStall(
  visible: string,
  messages: ConvMsg[],
  executedToolsInTurn: boolean,
  preToolPromiseContinuations: number
): boolean {
  if (preToolPromiseContinuations >= MAX_PRE_TOOL_PROMISE_CONTINUATIONS) return false;
  return looksLikePreToolPromiseStall(visible, messages, executedToolsInTurn);
}
