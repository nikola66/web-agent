// Apostrophe class: straight `'` or unicode `'` (U+2019). Models often emit
// the smart quote, so any commitment regex must accept both.
const APO = "['\u2019]";

function stripModelControlTokens(text) {
  if (!text) return "";
  return String(text).replace(/<[^>\n]*\|[^>\n]*>/g, "").trim();
}

const COMPLETION_RE =
  /(\bdone\b|\bcompleted\b|\bfinished\b|\ball set\b|anything else|what'?s next|ready when you are|that'?s all|that'?s it|in summary|to summarize|in conclusion|i'?m done|all tasks complete|here'?s (the |a |an )?(final )?(summary|overview|breakdown|recap)|here is (the |a |an )?(final )?(summary|overview|breakdown|recap))/;

const WAITING_FOR_USER_RE =
  /(let me know|do you want|would you like|should i\b|please confirm|please advise|wait for (you|your)|let you (know|decide)|need (any )?clarification|which (one|do you)|your call\b)/;

// "I read …" and contracted "I've read …" / "I'd checked …" / "I'll open …"
// (models often use contractions; a bare `\bi (read|…)\b` misses "i've read".)
const MID_TASK_VERBS =
  "(?:read|opened|checked|looked at|reviewed|found|searched|ran|loaded|fetched|inspected|examined|parsed)";
const MID_TASK_OBSERVATION_RE = new RegExp(
  `(?:\\bi ${MID_TASK_VERBS}\\b|\\bi${APO}(?:ve|d|ll)\\s+${MID_TASK_VERBS}\\b)`,
  "i"
);

const FINAL_ACTION_ANSWER_RE =
  /\b(i'?ve|i have|i) (created|wrote|updated|saved|implemented|fixed|set up|added|verified|confirmed|installed)\b[\s\S]{0,280}[.!]?\s*$/;

/** User wants heartbeat cron / recurring automation (maps to cron_register, not host crontab). */
const SCHEDULING_AUTOMATION_INTENT_RE = new RegExp(
  [
    "\\bcron\\s*jobs?\\b",
    "\\bcronjobs?\\b",
    "\\bcron\\b",
    "\\bdaily\\s+(digest|report|summary|ideas|reminder)\\b",
    "\\bweekly\\s+(digest|report|summary)\\b",
    "\\b(recurring|periodic)\\s+(job|task|digest|email|run)\\b",
    "\\b(schedule|scheduled)\\s+(a\\s+)?(job|task|cron)\\b",
    "\\bautomated\\s+(daily|weekly|email|digest)\\b",
    "\\bevery\\s+(morning|evening|night|noon|day|week|hour|minute)\\b",
    "\\bevery\\s+\\d+\\s*(hours?|minutes?|mins?|days?)\\b",
    "\\brun\\s+(every|each)\\s+(day|morning|evening|hour)\\b",
    "\\bsend\\s+me\\b[^.!?]{0,120}\\b(every|daily|each)\\s+(day|morning|evening)\\b",
    "\\bheartbeat\\s+(cron|job)\\b",
    "\\.cronjobs\\.json\\b",
  ].join("|"),
  "i"
);

export function isSchedulingAutomationIntent(input) {
  return SCHEDULING_AUTOMATION_INTENT_RE.test(String(input || "").toLowerCase());
}

/**
 * After the assistant replied with no tools: should we nudge toward cron_register?
 * Skips obvious clarifying questions and completion signals.
 */
export function shouldNudgeIncompleteSchedulingReply(visible) {
  const saidRaw = String(visible || "").trim();
  if (!saidRaw) return true;
  const said = saidRaw.toLowerCase();
  if (/\?\s*$/.test(saidRaw)) return false;
  if (WAITING_FOR_USER_RE.test(said)) return false;
  if (COMPLETION_RE.test(said)) return false;
  if (saidRaw.length > 1200) return false;
  return true;
}

function hasForwardLookingSignal(text) {
  return COMMITMENT_RE.test(text.toLowerCase()) || NEXT_STEP_RE.test(text) || /:\s*$/.test(text);
}

export function extractExactResponseTokens(input) {
  const text = String(input || "");
  const tokens: string[] = [];
  const patterns = [
    /\b(?:reply|respond|output)(?:\s+with)?\s+exactly\s*[:`"']?\s*([A-Za-z0-9][A-Za-z0-9_.:/-]{2,})/gi,
    /\b(?:ending|end)\s+with\s*[:`"']?\s*([A-Za-z0-9][A-Za-z0-9_.:/-]{2,})/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const token = String(match[1] || "").replace(/[.,;:!?)}\]"'`]+$/, "");
      if (token && !tokens.includes(token)) tokens.push(token);
    }
  }
  return tokens;
}

function normalizeExactToken(value) {
  return String(value || "").replace(/[_-]/g, "");
}

export function repairExactResponseText(input, visible) {
  let out = String(visible || "");
  const tokens = extractExactResponseTokens(input);
  if (!tokens.length || !out) return out;
  for (const token of tokens) {
    if (out.includes(token)) continue;
    const stripped = normalizeExactToken(token);
    if (!stripped || stripped === token) continue;
    const strippedRe = new RegExp(stripped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    if (strippedRe.test(out)) {
      out = out.replace(strippedRe, token);
      continue;
    }
    if (normalizeExactToken(out.trim()) === stripped) out = token;
  }
  return out;
}

// Forward-looking commitment phrases. Built dynamically so we accept both
// straight and unicode apostrophes. Crucially this does NOT gate on a specific
// verb — model phrasing varies too much ("I'll keep reading", "I'll continue",
// "Let me check the next snapshot", etc.) and a hardcoded verb list left huge
// gaps that caused the runtime to give up mid-task.
const COMMITMENT_RE = new RegExp(
  [
    `\\bi${APO}ll\\b`,
    `\\bi will\\b`,
    `\\bi${APO}m (going to|gonna|about to)\\b`,
    `\\blet me\\b`,
    `\\bgoing to\\b`,
    `\\bnow i${APO}ll\\b`,
    `\\bnext,?\\s+i${APO}ll\\b`,
    `\\bfirst,?\\s+i${APO}ll\\b`,
    `\\bi need to\\b`,
    `\\bcontinuing\\b`,
    `\\bnext step\\b`,
    `\\bmoving on\\b`,
    `\\bproceeding\\b`,
    `\\bcarrying on\\b`,
    `\\bkeep (reading|going|searching|exploring|looking|fetching|examining|parsing|loading|gathering|compiling|investigating|reviewing|checking|working|testing|trying|writing|inspecting|digging|crawling|browsing)\\b`,
    `\\bcontinue (reading|with|to|fetching|searching|investigating|reviewing|checking|working|testing|exploring|examining|trying|writing|inspecting|gathering|compiling|browsing)\\b`,
    `\\blet${APO}?s (continue|proceed|move on|keep going|see|check|look|review|examine|try|do this|start)\\b`,
  ].join("|")
);

// Step-header patterns models love when narrating a plan instead of executing
// it — e.g. "Next: list contents…", "Now: read the file", "Step 3: parse…",
// "### Next", "- Next: open the snapshot". Anchored to line start (allowing
// optional list markers or markdown heading hashes) so prose like "the next
// snapshot…" doesn't false-match. Multiline + case-insensitive.
const NEXT_STEP_RE =
  /(^|\n)[ \t]*(?:[*\-+][ \t]+|\d+[.)][ \t]+|#{1,6}[ \t]+)?(?:next|now|then|step[ \t]*\d+|next steps?|todo)[ \t]*[:\-—–][ \t]*\S/im;

/** User message suggests systematic / one-by-one tool exercise (shared by sequence nudge + turn guards). */
const TOOL_SEQUENCE_USER_INTENT_RE =
  /(?:\btest(?:ing|s)?\b|re-?test|\btry\b|continue testing|one\s+(?:by|bye|bie)\s+one|systematically|\ball tools\b|tool tests|sequentially|without stopping|until completion)/;

export function shouldAutoContinueToolSequence(input, visible, toolNames) {
  const userIntent = String(input || "").toLowerCase();
  if (!TOOL_SEQUENCE_USER_INTENT_RE.test(userIntent)) {
    return false;
  }
  const said = String(visible || "").toLowerCase();
  if (!/(now testing|next|continue|let'?s test|testing|test\s*\d+|step\s*\d+|i('| a)?ll test)/.test(said)) {
    return false;
  }
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedSaid = normalize(said);
  return (toolNames || []).some((name) => {
    const tool = String(name).toLowerCase();
    if (said.includes(tool)) return true;
    // Accept common model variants like "writefile" vs "write_file".
    return normalizedSaid.includes(normalize(tool));
  });
}

export function isToolSequenceIntent(input) {
  const userIntent = String(input || "").toLowerCase();
  return TOOL_SEQUENCE_USER_INTENT_RE.test(userIntent);
}

export function isExplicitSequenceCompletion(visible) {
  const said = String(visible || "").toLowerCase();
  return /(all tools tested|testing complete|tests complete|completed all|finished testing|done testing)/.test(
    said
  );
}

/** Same-task retry — still allow action-plan auto-continue when the model stalled mid-step. */
const RETRY_SAME_TASK_RE = /^(try again|retry|again\.?|please retry|one more time)\b/i;

const EXPLICIT_TOPIC_PIVOT_PREFIX_RE =
  /^(now |instead|actually|forget (about )?(that|this|the previous)|switch (gears|topics|to)|different (task|question|topic)|new (task|question|topic)|moving on|stop (that|this)|on a different note|separate question|unrelated(\s+question)?|quick question|change (of )?subject|leave that|drop that|never ?mind that)\b/i;

/**
 * When the user's latest message looks like a new topic vs their prior turn, suppress
 * *action-plan* auto-continue (no tools yet, assistant only said "I'll…"). Otherwise a
 * topic switch still triggers "continue" nudges and the model resumes the old thread.
 */
export function shouldSuppressActionPlanAutoContinue(currentRaw, previousRaw) {
  const current = String(currentRaw || "").trim();
  const previous = String(previousRaw || "").trim();
  if (!current || !previous) return false;
  if (current === previous) return false;
  if (RETRY_SAME_TASK_RE.test(current)) return false;
  if (isToolSequenceIntent(current)) return false;
  if (EXPLICIT_TOPIC_PIVOT_PREFIX_RE.test(current)) return true;

  const tokenize = (s) => {
    const words = String(s || "")
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    return new Set(words);
  };

  const curLower = current.toLowerCase();
  if (curLower.length < 22) return false;

  const a = tokenize(current);
  const b = tokenize(previous);
  if (a.size === 0) return false;
  let inter = 0;
  for (const w of a) {
    if (b.has(w)) inter += 1;
  }
  const denom = Math.min(a.size, Math.max(b.size, 1));
  const overlap = denom ? inter / denom : 0;
  return overlap < 0.14;
}

export function shouldAutoContinueActionPlan(input, visible) {
  const userIntent = String(input || "").toLowerCase();
  const saidRaw = String(visible || "").trim();
  const said = saidRaw.toLowerCase();
  if (!userIntent || !saidRaw) return false;
  if (/\?\s*$/.test(saidRaw)) return false;
  if (COMPLETION_RE.test(said)) return false;
  if (WAITING_FOR_USER_RE.test(said)) return false;
  // Trailing colon ("Next steps:") signals the model is about to enumerate
  // actions, which usually means it should keep going.
  return (
    COMMITMENT_RE.test(said) ||
    NEXT_STEP_RE.test(saidRaw) ||
    /:\s*$/.test(saidRaw)
  );
}

/**
 * Decide whether to nudge the model after a round of tool execution that
 * produced a text-only response with no further tool calls.
 *
 * Unlike `shouldAutoContinueActionPlan`, this is meant to be called only after
 * the agent has already executed at least one tool in the current turn. In
 * that context, the bar is lower: any forward-looking commitment ("I'll keep
 * reading…", "Let me check the next file") should trigger a nudge, but we
 * still respect explicit completion signals or questions back to the user.
 *
 * Empty visible text after tool execution is also treated as continue-worthy:
 * an empty assistant message after a tool call almost always means the model
 * paused mid-step rather than reaching a final answer.
 */
export function shouldAutoContinueAfterToolUse(visible) {
  const saidRaw = String(visible || "").trim();
  if (!saidRaw) return true;
  const said = saidRaw.toLowerCase();
  if (/\?\s*$/.test(saidRaw)) return false;
  if (COMPLETION_RE.test(said)) return false;
  if (WAITING_FOR_USER_RE.test(said)) return false;
  return (
    COMMITMENT_RE.test(said) ||
    NEXT_STEP_RE.test(saidRaw) ||
    /:\s*$/.test(saidRaw)
  );
}

/**
 * Strict post-tool continuation policy (Tier 3 in the plan).
 *
 * Hermes-style "the model went mid-task quiet after a tool batch" guard.
 * This is intentionally narrower than a blind "always continue after tools"
 * rule: direct final answers should stop, while observation-only status lines
 * ("I read run_1778…json. The snapshot mentions…") still get a recovery nudge.
 *
 * Caller is responsible for capping invocations via MAX_AUTO_CONTINUE_NUDGES
 * so this never produces a runaway loop.
 */
export function shouldAutoContinueStrict(visible) {
  const saidRaw = String(visible || "").trim();
  if (!saidRaw) return true;
  const said = saidRaw.toLowerCase();
  if (/\?\s*$/.test(saidRaw)) return false;
  if (COMPLETION_RE.test(said)) return false;
  if (WAITING_FOR_USER_RE.test(said)) return false;
  if (hasForwardLookingSignal(saidRaw)) return true;
  if (FINAL_ACTION_ANSWER_RE.test(said)) return false;
  return MID_TASK_OBSERVATION_RE.test(said);
}

/**
 * After tools have already run in a turn, some models emit a direct answer and
 * still attach another stale tool call. Treat direct, non-forward-looking text
 * as final so the stale call cannot restart the run.
 */
export function shouldTreatPostToolTextAsFinal(visible) {
  const saidRaw = stripModelControlTokens(String(visible || "")).trim();
  if (!saidRaw) return false;
  const said = saidRaw.toLowerCase();
  if (/\?\s*$/.test(saidRaw)) return false;
  if (WAITING_FOR_USER_RE.test(said)) return false;
  if (shouldAutoContinueAfterToolUse(saidRaw)) return false;
  if (shouldAutoContinueStrict(saidRaw)) return false;
  return true;
}
