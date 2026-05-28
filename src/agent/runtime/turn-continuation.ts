/**
 * Turn continuation recovery — ported from Hermes agent/agent_runtime_helpers.py
 * (looks_like_codex_intermediate_ack) and agent/conversation_loop.py (empty-after-tools nudge).
 */

import fs from "node:fs/promises";
import { workspaceStatePath } from "./constants.js";
import { isApiCallIntent } from "./turn-sequencing.js";

export const MAX_INTERMEDIATE_ACK_CONTINUATIONS = 2;
export const MAX_EMPTY_AFTER_TOOLS_CONTINUATIONS = 1;
export const MAX_EMPTY_RESPONSE_CONTINUATIONS = 2;
export const MAX_TRUNCATION_CONTINUATIONS = 2;
export const MAX_POST_TOOL_STALL_CONTINUATIONS = 5;
export const MAX_SNAPSHOT_READ_STALL_CONTINUATIONS = 2;
export const MAX_API_DISCOVERY_STALL_CONTINUATIONS = 1;
export const MAX_PRE_TOOL_PROMISE_CONTINUATIONS = 5;
export const MAX_CRON_VERIFY_CONTINUATIONS = 1;
export const MAX_INCOMPLETE_TODO_CONTINUATIONS = 2;
export const MAX_FIND_SKILLS_DELIVERY_CONTINUATIONS = 3;

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
  /\blet's\b/i,
  /\btrying\b/i,
  /\battempting\b/i,
  /\bnext,?\s+(?:trying|attempting)\b/i,
  /\bi['']?m (?:now )?(?:executing|implementing|applying|patching|updating|registering|refreshing|re-registering|configuring|working on|locking in)\b/i,
  /\bi am (?:now )?(?:executing|implementing|applying|patching|updating|registering|refreshing|re-registering|configuring|working on|locking in)\b/i,
  /\b(?:executing|implementing|applying|patching|updating|registering|refreshing|configuring) now\b/i,
  /\b(?:step \d+|step one|step two):?\s/i,
  /\bworking on (?:this|it|that) now\b/i,
  /\block(?:ing)? (?:this )?in now\b/i,
  /\bi['']?m switching to\b/i,
  /\bswitching to the native\b/i,
  /\blet's start with\b/i,
  /\bstarting with the\b/i,
];

export function matchesFutureActionIntent(text: string): boolean {
  const low = String(text || "").trim().toLowerCase();
  if (!low) return false;
  if (FUTURE_ACTION_INTENT_RES.some((re) => re.test(low))) return true;
  if (/\b(?:registering|updating|refreshing|patching|implementing)\b/i.test(low)) return true;
  return false;
}

/** Agent stall filler — not a request for user-supplied input. */
const AGENT_STALL_PHRASE_RES: RegExp[] = [
  /\bgive me a (?:second|moment|minute|sec|bit|while|few)\b/i,
  /\bbear with me\b/i,
  /\bjust a (?:second|moment|minute|sec)\b/i,
];

/** English patterns where the agent is asking the user to decide, choose, or supply info — do not nudge. */
const USER_INPUT_REQUEST_RES: RegExp[] = [
  /\bgive me (?!(?:a )?(?:second|moment|minute|sec|bit|while|few)\b)/i,
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
  /\bchoose (?:one|between|which|your)(?!\s+(?:of|from|among|within|between)\b)/i,
  /\bpick (?:one|between|which|your)(?!\s+(?:of|from|among|within|between)\b)/i,
  /\bselect (?:one|which|your|an option)(?!\s+(?:of|from|among|within)\b)/i,
  /\bpick from (?:these|the following|your|our|below|above)\b/i,
  /\bselect from (?:these|the following|your|our|below|above)\b/i,
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
  if (AGENT_STALL_PHRASE_RES.some((re) => re.test(low))) return false;
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

const PIVOT_ACTION_TAIL_RES: RegExp[] = [
  /\bweb_search\b/i,
  /\bweb_fetch\b/i,
  /\b(?:i['']?ll|i will)\s+(?:try|use|fetch|search|look)\b/i,
  /\bpivot\b/i,
  /\bofficialskills\b/i,
  /\bdone guessing\b/i,
  /\bghost town\b/i,
];

function tailPromisesPivotAction(text: string): boolean {
  const tail = tailSentences(text, 3);
  if (PIVOT_ACTION_TAIL_RES.some((re) => re.test(tail))) return true;
  return matchesFutureActionIntent(tail);
}

/** Model promises to run a cron job manually — not supported. */
export function looksLikeFalseManualCronPromise(text: string): boolean {
  const low = String(text || "").trim().toLowerCase();
  if (!low) return false;
  return (
    /\bmanual(?:ly)?\s+(?:run|start|kick|trigger|execute)\b/i.test(low) ||
    /\bkick\s+off\s+(?:a\s+)?(?:manual\s+)?(?:run\s+of\s+)?(?:the\s+)?cron\b/i.test(low) ||
    /\brun\s+the\s+cron\s+(?:manually|now|immediately)\b/i.test(low) ||
    /\btrigger\s+the\s+cron\b/i.test(low) ||
    /\bwhy\s+wait\s+for\s+the\s+timer\b/i.test(low)
  );
}

/** Agent plans to choose from a found set — not asking the user to choose. */
function looksLikeAgentSelfSelection(low: string): boolean {
  return (
    /\bpick (?:one|a|an) (?:of|from|among|within)\b/i.test(low) ||
    /\bselect (?:one|a|an) (?:of|from|among|within)\b/i.test(low)
  );
}

/** Closing sentences commit to an imminent tool step (overrides mid-text false positives). */
function tailHasStrongToolCommitment(text: string): boolean {
  return tailPromisesFurtherAction(text);
}

/** True when the turn should end — user ask, final deliverable, blocker, or wrap-up. */
export function shouldSuppressContinuationNudge(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (matchesUserInputRequest(raw)) {
    if (
      (tailPromisesFurtherAction(raw) || tailPromisesPivotAction(raw)) &&
      /\b(?:plan:|sequence:|step \d+|let's start|starting with|i'm switching)\b/i.test(raw)
    ) {
      return false;
    }
    return true;
  }
  if (matchesTaskCompletionOrFinalState(raw)) {
    if (tailPromisesFurtherAction(raw) || tailPromisesPivotAction(raw)) return false;
    return true;
  }
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
  "executing",
  "continue",
  "walkthrough",
  "report back",
  "summarize",
  "register",
  "re-register",
  "update",
  "configure",
  "configuration",
  "refresh",
  "patch",
  "implement",
  "lock in",
  "cron",
  "schedule",
  "send",
  "email",
  "personalize",
  "log",
  "finish",
  "wider",
  "narrow",
  "expand",
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

export function looksLikeEmptyAfterTools(visible: string, executedToolsInTurn: boolean): boolean {
  if (!executedToolsInTurn) return false;
  return !String(visible || "").trim();
}

function looksLikeActionPromiseStall(visible: string): boolean {
  const text = String(visible || "").trim();
  if (!text) return false;
  const low = text.toLowerCase();
  const tailCommit = tailHasStrongToolCommitment(text);
  if (tailCommit) {
    if (shouldSuppressContinuationNudge(text)) {
      if (!(looksLikeAgentSelfSelection(low) && tailCommit)) return false;
    }
    return true;
  }
  if (low.length > 1200) return false;
  if (
    looksLikeFalseManualCronPromise(low) &&
    matchesFutureActionIntent(low)
  ) {
    return true;
  }
  if (shouldSuppressContinuationNudge(text)) {
    if (!(looksLikeAgentSelfSelection(low) && tailCommit)) return false;
  }
  if (!matchesFutureActionIntent(low)) return false;
  return ACTION_MARKERS.some((marker) => low.includes(marker));
}

/** After tools ran: promised next action in text but no follow-up tool calls (Hermes empty-nudge spirit). */
export function looksLikePostToolStall(visible: string, executedToolsInTurn: boolean): boolean {
  if (!executedToolsInTurn) return false;
  return looksLikeActionPromiseStall(visible);
}

type SnapshotReadExecution = {
  tool?: string;
  result?: { path?: string; from_snapshot?: boolean };
};

/** After read_file on memory/snapshots: model narrates a loop instead of using unwrapped tool output. */
export function looksLikeSnapshotReadStall(
  visible: string,
  executedToolsInTurn: boolean,
  lastExecutions: SnapshotReadExecution[]
): boolean {
  if (!executedToolsInTurn || !lastExecutions?.length) return false;
  const readSnapshot = lastExecutions.some(
    (item) =>
      item?.tool === "read_file" &&
      (item?.result?.from_snapshot === true ||
        String(item?.result?.path || "").includes("memory/snapshots/"))
  );
  if (!readSnapshot) return false;
  const low = String(visible || "").trim().toLowerCase();
  if (!low) return true;
  if (/\b(?:snapshot|result_ref|spill)\b/.test(low) && (/\bloop\b/.test(low) || /\bredirect/.test(low))) {
    return true;
  }
  if (
    /\b(?:snapshot|result_ref|spill)\b/.test(low) &&
    /\b(?:empty|nothing|no data|didn't provide|did not provide|glitch|fighting|stop fighting|not help)\b/.test(
      low
    )
  ) {
    return true;
  }
  if (
    /\b(?:read(?:ing)?|rerun(?:ning)?)\b.*\b(?:snapshot|result_ref)\b/.test(low) ||
    /\b(?:snapshot|result_ref)\b.*\b(?:again|one more time|properly|different approach)\b/.test(low)
  ) {
    return true;
  }
  if (/\bmemory\/runs\b/.test(low) || /\brun_\d+/.test(low)) return true;
  return looksLikeActionPromiseStall(visible);
}

type ApiDiscoveryExecution = {
  tool?: string;
  result?: { ok?: boolean; url?: string; status?: number };
};

function httpResourcePathDepth(url: string): number {
  try {
    return new URL(String(url || "")).pathname.split("/").filter(Boolean).length;
  } catch {
    const tail = String(url || "").split("?")[0]?.split("#")[0] ?? "";
    const segments = tail.split("/").filter(Boolean).length;
    return segments > 0 ? segments - 1 : 0;
  }
}

/** After 403/404 on a guessed resource path, model asks user instead of skill discovery. */
export function looksLikeApiDiscoveryStall(
  userMessage: string,
  visible: string,
  executedToolsInTurn: boolean,
  lastExecutions: ApiDiscoveryExecution[]
): boolean {
  if (!executedToolsInTurn || !lastExecutions?.length) return false;
  if (!isApiCallIntent(userMessage)) return false;
  const lastHttp = [...lastExecutions]
    .reverse()
    .find((e) => e?.tool === "web_fetch" || e?.tool === "web_post");
  const r = lastHttp?.result;
  if (!r || r.ok !== false) return false;
  const status = Number(r.status);
  if (status !== 403 && status !== 404) return false;
  if (httpResourcePathDepth(String(r.url || "")) < 2) return false;
  const low = String(visible || "").toLowerCase();
  if (/\bskill_view\b/.test(low) && /\bdiscover|list|metadata|schema|health|ping\b/.test(low)) {
    return false;
  }
  if (/\bweb_fetch\b/.test(low) && /\blist|metadata|discover|schema\b/.test(low)) return false;
  if (
    /\bslug|resource name|flying blind|don't have a list|do you know|should i try to list|list all available|what we actually have access|403 forbidden|wrong (?:slug|id|name)/i.test(
      low
    )
  ) {
    return true;
  }
  return looksLikeActionPromiseStall(visible);
}

/** Before any tools this turn: promised action but no tool calls. */
export function looksLikePreToolPromiseStall(
  visible: string,
  _messages: ConvMsg[],
  executedToolsInTurn: boolean
): boolean {
  if (executedToolsInTurn) return false;
  return looksLikeActionPromiseStall(visible);
}

export function looksLikeEmptyResponse(visible: string): boolean {
  return !String(visible || "").trim();
}

/** find-skills ran web discovery but never delivered the ranked pipe table. */
export function looksLikeFindSkillsDeliveryStall(
  userMessage: string,
  visible: string,
  executedToolsInTurn: boolean,
  webDiscoveryCalls: number
): boolean {
  if (!executedToolsInTurn) return false;
  if (!/find-skills mode/i.test(String(userMessage || ""))) return false;
  if (webDiscoveryCalls < 2) return false;
  const vis = String(visible || "").trim();
  if (/\|\s*#\s*\|/i.test(vis) && /\|\s*Skill/i.test(vis)) return false;
  const pipes = vis.match(/\|/g)?.length ?? 0;
  if (/top 5 skills/i.test(vis) && pipes >= 6) return false;
  return webDiscoveryCalls >= 2;
}

export function looksLikeTruncatedResponse(finishReason: string | null | undefined): boolean {
  return String(finishReason || "").trim().toLowerCase() === "length";
}

export type ContinuationNudgeKind =
  | "intermediate_ack"
  | "empty_after_tools"
  | "empty_response"
  | "truncation"
  | "post_tool_stall"
  | "snapshot_read_stall"
  | "api_discovery_stall"
  | "pre_tool_promise"
  | "cron_verify"
  | "incomplete_todos"
  | "all_tools_rejected"
  | "find_skills_delivery";

export type TodoCompletionStats = {
  total: number;
  completed: number;
  open: number;
};

export async function loadTodoCompletionStats(): Promise<TodoCompletionStats> {
  const todosPath = workspaceStatePath(".webagent/todos.json");
  try {
    const raw = await fs.readFile(todosPath, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [];
    let completed = 0;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const status = String((item as { status?: string }).status || "pending").trim();
      if (status === "completed" || status === "cancelled") completed += 1;
    }
    const total = items.length;
    return { total, completed, open: Math.max(0, total - completed) };
  } catch {
    return { total: 0, completed: 0, open: 0 };
  }
}

function userRequiredFinalLineSatisfied(userMessage: string, visible: string): boolean {
  const req =
    /end with exactly(?:\s+this line)?(?:\s+and nothing after it)?[:\s]*["']?([^\n"']+)/i.exec(
      String(userMessage || "")
    );
  if (!req) return false;
  const line = String(req[1] || "").trim().toLowerCase();
  if (!line) return false;
  return String(visible || "").trim().toLowerCase().includes(line);
}

export function userRequestedStructuredTodos(userMessage: string): boolean {
  const text = String(userMessage || "").trim().toLowerCase();
  if (!text) return false;
  return (
    /\btodo_write\b/.test(text) ||
    /\bchecklist\b/.test(text) ||
    /\bone round per\b/.test(text) ||
    /\bminimum\s+\d{1,2}\s+tool\s+rounds?\b/.test(text) ||
    /\b(\d{1,2})\s+items?\b/.test(text) ||
    /\b(\d{1,2})\s+steps?\b/.test(text) ||
    /\bexecute each item\b/.test(text)
  );
}

export function shouldContinueIncompleteTodos(
  userMessage: string,
  executedToolsInTurn: boolean,
  incompleteTodoContinuations: number,
  stats: TodoCompletionStats,
  visible = ""
): boolean {
  if (incompleteTodoContinuations >= MAX_INCOMPLETE_TODO_CONTINUATIONS) return false;
  if (!executedToolsInTurn || !userRequestedStructuredTodos(userMessage)) return false;
  if (stats.total < 2) return false;
  if (stats.open <= 0) return false;
  if (userRequiredFinalLineSatisfied(userMessage, visible)) return false;
  if (matchesTaskCompletionOrFinalState(String(visible || "")) && !tailPromisesFurtherAction(visible)) {
    return false;
  }
  return true;
}

export function cronRegisterJobIdFromArgs(args: Record<string, unknown> | null | undefined): string {
  if (String(args?.action ?? "").trim().toLowerCase() === "remove") return "";
  return String(args?.id ?? "").trim();
}

export function cronJobIdsFromListResult(result: unknown): Set<string> {
  const ids = new Set<string>();
  const row = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
  const jobs = Array.isArray(row?.jobs) ? row.jobs : [];
  for (const job of jobs) {
    if (job && typeof job === "object" && !Array.isArray(job)) {
      const id = String((job as Record<string, unknown>).id ?? "").trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

const REPEATED_STALL_NUDGE =
  " Do not send another status message — emit the next tool call in this same turn.";

export function buildContinuationNudge(
  kind: ContinuationNudgeKind,
  extra?: {
    pendingCronIds?: string[];
    falseManualCron?: boolean;
    openTodos?: number;
    totalTodos?: number;
    rejectedToolNames?: string[];
    continuationCount?: number;
  }
): string {
  const repeatedStall =
    (extra?.continuationCount ?? 0) >= 2 &&
    (kind === "post_tool_stall" || kind === "pre_tool_promise");
  if (kind === "empty_after_tools") {
    return (
      "You just executed tool calls but returned an empty response. " +
      "Please process the tool results above and continue with the task."
    );
  }
  if (kind === "empty_response") {
    return (
      "You returned an empty response. Continue the task now by calling the required tools."
    );
  }
  if (kind === "truncation") {
    return "Continue exactly where you left off.";
  }
  if (kind === "post_tool_stall") {
    const cronHint = extra?.falseManualCron
      ? " There is no manual cron run — jobs execute only on heartbeat ticks while the tab is open. " +
        "To work now, call the job step tools in this chat; otherwise use cron_list and cite nextEligibleAtMs."
      : "";
    return (
      "You executed tool calls but ended with only a promise to take the next step. " +
      "Process the tool results above and continue now by calling the tools needed for that step." +
      cronHint +
      (repeatedStall ? REPEATED_STALL_NUDGE : "")
    );
  }
  if (kind === "snapshot_read_stall") {
    return (
      "You read a memory/snapshots spill file. Prefer `list_digest` from the latest \"Tool results (compact JSON)\" when present. " +
      "Otherwise use unwrapped `content` from read_file (or inlined `result`). If the body is HTML or an auth recovery note, " +
      "rerun web_fetch/web_post with Authorization — do not read_file another snapshot or JSON.parse spill files."
    );
  }
  if (kind === "api_discovery_stall") {
    return (
      "Before asking the user for a resource slug or id, follow the imported skill's discovery procedure " +
      "(health, list metadata, schema — see skill_view on that skill and **`http-api`**). " +
      "Do not guess resource paths until discovery returns or proves metadata is forbidden."
    );
  }
  if (kind === "pre_tool_promise") {
    return (
      "You ended with only a promise to take the next step. " +
      "Continue now by calling the tools needed for that step." +
      (repeatedStall ? REPEATED_STALL_NUDGE : "")
    );
  }
  if (kind === "cron_verify") {
    const ids = (extra?.pendingCronIds ?? []).filter(Boolean);
    const idHint = ids.length ? ` (${ids.join(", ")})` : "";
    return (
      "You called cron_register but have not verified persistence with cron_list yet. " +
      `Call cron_list now and confirm the job id${idHint} appears in the tool result before telling the user the cron job is registered or active.`
    );
  }
  if (kind === "incomplete_todos") {
    const open = Math.max(0, Number(extra?.openTodos ?? 0));
    const total = Math.max(open, Number(extra?.totalTodos ?? 0));
    return (
      `Your todo checklist is incomplete (${open} of ${total} items still open). ` +
      "Continue the next checklist item now with the required tool call(s). " +
      "Update todo_write as you finish items. Do not stop until all items are completed or cancelled, " +
      "then send the user's requested final line."
    );
  }
  if (kind === "find_skills_delivery") {
    return (
      "You completed find-skills web_search/web_fetch but have not delivered the final answer. " +
      "Stop fetching more registry pages. Synthesize from search snippets and any successful fetches you already have. " +
      "Present exactly 5 deduped skills in a markdown pipe table (Skill | Registry | Popularity | Summary | Install/link) " +
      "ranked by installs, stars, or votes — note 'metric unavailable' when a registry blocked fetch. Do not install."
    );
  }
  if (kind === "all_tools_rejected") {
    const names = extra?.rejectedToolNames;
    const nameList = Array.isArray(names) && names.length
      ? ` (${names.slice(0, 6).join(", ")})`
      : "";
    return (
      `The tool call(s)${nameList} you just attempted are not available in this environment. ` +
      "These are likely tool names from a different agent host (Claude Code, Cursor, Composio, etc.) that do not exist here. " +
      "Use only the tools available in this Web Agent: write_file, read_file, edit_file, run_python, run_shell, " +
      "web_fetch, web_post, web_search, grep, find_files, list_dir, skill_view, skill_manage, artifact_present, and similar built-ins. " +
      "Continue the task now using the correct tools."
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

export function buildEmptyResponseRecoveryUserMessage(): ConvMsg & { _empty_recovery_synthetic: true } {
  return {
    role: "user",
    content: buildContinuationNudge("empty_response"),
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

export function shouldContinueEmptyResponse(
  visible: string,
  emptyResponseContinuations: number
): boolean {
  if (emptyResponseContinuations >= MAX_EMPTY_RESPONSE_CONTINUATIONS) return false;
  return looksLikeEmptyResponse(visible);
}

export function shouldContinueTruncation(
  finishReason: string | null | undefined,
  truncationContinuations: number
): boolean {
  if (truncationContinuations >= MAX_TRUNCATION_CONTINUATIONS) return false;
  return looksLikeTruncatedResponse(finishReason);
}

export function shouldContinuePostToolStall(
  visible: string,
  executedToolsInTurn: boolean,
  postToolStallContinuations: number
): boolean {
  if (postToolStallContinuations >= MAX_POST_TOOL_STALL_CONTINUATIONS) return false;
  return looksLikePostToolStall(visible, executedToolsInTurn);
}

export function shouldContinueFindSkillsDelivery(
  userMessage: string,
  visible: string,
  executedToolsInTurn: boolean,
  webDiscoveryCalls: number,
  findSkillsDeliveryContinuations: number
): boolean {
  if (findSkillsDeliveryContinuations >= MAX_FIND_SKILLS_DELIVERY_CONTINUATIONS) return false;
  return looksLikeFindSkillsDeliveryStall(userMessage, visible, executedToolsInTurn, webDiscoveryCalls);
}

export function shouldContinueSnapshotReadStall(
  visible: string,
  executedToolsInTurn: boolean,
  lastExecutions: SnapshotReadExecution[],
  snapshotReadStallContinuations: number
): boolean {
  if (snapshotReadStallContinuations >= MAX_SNAPSHOT_READ_STALL_CONTINUATIONS) return false;
  return looksLikeSnapshotReadStall(visible, executedToolsInTurn, lastExecutions);
}

export function shouldContinueApiDiscoveryStall(
  userMessage: string,
  visible: string,
  executedToolsInTurn: boolean,
  lastExecutions: ApiDiscoveryExecution[],
  apiDiscoveryStallContinuations: number
): boolean {
  if (apiDiscoveryStallContinuations >= MAX_API_DISCOVERY_STALL_CONTINUATIONS) return false;
  return looksLikeApiDiscoveryStall(userMessage, visible, executedToolsInTurn, lastExecutions);
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

export function shouldContinueCronVerification(
  pendingCronRegisterIds: Set<string>,
  cronVerifyContinuations: number
): boolean {
  if (cronVerifyContinuations >= MAX_CRON_VERIFY_CONTINUATIONS) return false;
  return pendingCronRegisterIds.size > 0;
}

export async function shouldContinueIncompleteTodosAsync(
  userMessage: string,
  executedToolsInTurn: boolean,
  incompleteTodoContinuations: number,
  visible = ""
): Promise<{ continue: boolean; stats: TodoCompletionStats }> {
  const stats = await loadTodoCompletionStats();
  return {
    continue: shouldContinueIncompleteTodos(
      userMessage,
      executedToolsInTurn,
      incompleteTodoContinuations,
      stats,
      visible
    ),
    stats,
  };
}
