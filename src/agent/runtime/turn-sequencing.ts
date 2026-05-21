/** Open-web discovery: find/list/who posts about + external entities or platforms. */
export const RESEARCH_INTENT_RE = new RegExp(
  [
    "\\b(find|discover|list|identify|locate|search for|look for|who)\\b[^.!?]{0,120}\\b(youtubers?|creators?|influencers?|channels?|people|companies|communities|reviewers?|posting about|talking about|covering)\\b",
    "\\b(youtubers?|creators?|influencers?)\\b[^.!?]{0,80}\\b(in|from|based in)\\b",
    "\\bwho\\s+(posts?|talks?|makes?\\s+videos?)\\s+about\\b",
    "\\bposting\\s+about\\b",
  ].join("|"),
  "i"
);

export const MIN_RESEARCH_SEARCHES = 4;
export const MIN_RESEARCH_FETCHES = 2;

export function isResearchIntent(input) {
  return RESEARCH_INTENT_RE.test(String(input || ""));
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

const TOOL_SEQUENCE_USER_INTENT_RE =
  /(?:\btest(?:ing|s)?\b|re-?test|\btry\b|continue testing|one\s+(?:by|bye|bie)\s+one|systematically|\ball tools\b|tool tests|sequentially|without stopping|until completion)/;

function isToolSequenceIntent(input) {
  return TOOL_SEQUENCE_USER_INTENT_RE.test(String(input || "").toLowerCase());
}

function estimateTaskStepsFromInput(input) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return 1;

  let score = 1;

  const stepNumberMatch = text.match(/\b(\d{1,2})\s+(steps?|tasks?)\b/);
  if (stepNumberMatch) {
    const n = Number(stepNumberMatch[1]);
    if (Number.isFinite(n) && n > score) score = n;
  }

  const connectors = text.match(/\b(and then|then|next|after that|finally|first|second|third)\b/g);
  if (connectors?.length) {
    score = Math.max(score, 1 + connectors.length);
  }

  if (isToolSequenceIntent(text) || /\b(all tools|one by one|systematically|without stopping)\b/.test(text)) {
    score = Math.max(score, 7);
  }

  let roundsN = 0;
  const roundsMatch = text.match(/\b(\d{1,2})\s+rounds?\b/);
  if (roundsMatch) {
    roundsN = Number(roundsMatch[1]);
    if (Number.isFinite(roundsN) && roundsN >= 2) score = Math.max(score, 7);
  }

  const imperativeHits = text.match(
    /\b(refactor|migrate|implement|notify|remove|add|update|fix|research|translate|write|summarize|summarise|save|fetch|install|verify|test)\b/g
  );
  if (imperativeHits && imperativeHits.length >= 5) score = Math.max(score, 7);

  const semiChunks = text.split(";").map((s) => s.trim()).filter((s) => s.length > 6);
  if (semiChunks.length >= 4) score = Math.max(score, 7);

  if (/\brepeat\s+until\b/.test(text) && /\b(articles?|files?|outputs?)\b/.test(text)) {
    score = Math.max(score, 7);
  }

  if (
    Number.isFinite(roundsN) &&
    roundsN >= 2 &&
    /\b(research|write|summarize|summarise)\b/.test(text) &&
    /\btranslate\b/.test(text)
  ) {
    score = Math.max(score, 8);
  }

  return Math.max(1, Math.min(score, 12));
}

/** Lightweight tier for todo (>3 steps) vs plan (>6) gates; aligns with Hermes-style discipline. */
export function estimateTaskComplexity(input) {
  const estimatedSteps = estimateTaskStepsFromInput(input);
  const tier = estimatedSteps > 6 ? "plan" : estimatedSteps > 3 ? "todo" : "simple";
  return { estimatedSteps, tier };
}

/** True when content is the synthetic `/plan` user prompt from planning-slash. */
export function isPlanningModePrompt(input) {
  return /invoked \*\*planning mode\*\* via `\/plan`/i.test(String(input || ""));
}

/** Pull `**Goal:**` line from synthetic planning prompts (`buildPlanModeUserPrompt`). */
export function extractPlanningGoalFromPrompt(content) {
  const raw = String(content || "").replace(/\r\n/g, "\n");
  const m = /\*\*Goal:\*\*\s*([^\r\n]+)/i.exec(raw);
  return m ? String(m[1] ?? "").trim() : "";
}

const PLAN_APPROVAL_EXECUTION_RE =
  /\b(plan\s+is\s+approved|approved\s+plan|approve(?:d)?\s+(?:the\s+)?plan|execute\s+(?:the\s+)?plan|proceed\s+with\s+(?:the\s+)?plan|start\s+(?:the\s+)?plan|run\s+(?:the\s+)?plan)\b/i;

function extractPlanFilePath(text) {
  const s = String(text || "");
  const legacy = /(^|[\s`"'([{])(\.webagent\/plans\/[^\s`"')\]}]+\.md)\b/i.exec(s);
  if (legacy) return String(legacy[2] || "").trim();
  const modern = /(^|[\s`"'([{])(plans\/[^\s`"')\]}]+\.md)\b/i.exec(s);
  return modern ? String(modern[2] || "").trim() : "";
}

/** Current-turn only: user explicitly asked to run an approved plan (not bleed from prior `/plan`). */
export function isExplicitPlanExecutionRequest(content) {
  const cur = String(content || "").trim();
  if (!cur || isPlanningModePrompt(cur)) return false;
  return PLAN_APPROVAL_EXECUTION_RE.test(cur) || !!extractPlanFilePath(cur);
}

/** One-shot context prefix when the user explicitly approves plan execution this turn. */
export function buildPlanExecutionContextPrefix(content) {
  if (!isExplicitPlanExecutionRequest(content)) return null;
  return "[Approved plan execution context] The user already approved execution of an existing plan. Do not ask them to restate or paste the plan again. If the user message includes `plans/*.md` or legacy `.webagent/plans/*.md`, read that file first. Otherwise list `plans/`, pick the newest markdown plan file; if none, check `.webagent/plans/`, then execute.";
}

export function getSkillSelfImproveNudgeState({
  executedToolsInTurn,
  usedTodoWrite,
  usedPlanningGate,
  estimatedStepsOverSix,
  skillMutatingCalled,
  skillImproveNudgeSent,
}: {
  executedToolsInTurn?: boolean;
  usedTodoWrite?: boolean;
  usedPlanningGate?: boolean;
  estimatedStepsOverSix?: boolean;
  skillMutatingCalled?: boolean;
  skillImproveNudgeSent?: boolean;
}) {
  const eligible =
    executedToolsInTurn &&
    !skillMutatingCalled &&
    !skillImproveNudgeSent &&
    (usedTodoWrite || usedPlanningGate || estimatedStepsOverSix);
  return { shouldNudge: !!eligible };
}
