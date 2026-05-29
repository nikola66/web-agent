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

export const SKILL_INSTALL_INTENT_RE = new RegExp(
  [
    "\\b(install(?:ing)?|add|import|bulk|save)\\b[^.!?]{0,60}\\bskills?\\b",
    "\\bcontinue\\s+installing\\b",
    "skill_bulk_save",
    "\\bskill\\b[^.!?]{0,40}\\baction\\s*[:=]\\s*['\"]?bulk",
    "officialskills\\.sh",
    "skills\\.sh/",
    "skillsmp\\.com",
  ].join("|"),
  "i"
);

export function isSkillInstallIntent(input) {
  return SKILL_INSTALL_INTENT_RE.test(String(input || ""));
}

export const SKILL_INSTALL_FOCUSED_TOOL_NAMES = [
  "archive_list",
  "extract_archive",
  "browse_workspace",
  "grep",
  "read_file",
  "skill",
  "web_fetch",
  "web_search",
];

export function focusToolNamesForIntent(allNames: string[] = [], input = ""): string[] {
  if (!isSkillInstallIntent(input)) return allNames;
  const focused = new Set(SKILL_INSTALL_FOCUSED_TOOL_NAMES);
  const next = allNames.filter((name) => focused.has(name));
  return next.length ? next : allNames;
}

/**
 * Input carries (or references) an image, audio, video, or YouTube link — the
 * cases the `multimodal-ingest` skill handles. Used to pre-unlock the deferred
 * `multimodal` tool group so `vision_analyze`/`audio_analyze`/`youtube_transcribe`
 * are active on the same turn instead of forcing a tool_activate hop.
 */
export const MULTIMODAL_INPUT_RE = new RegExp(
  [
    "data:(?:image|audio|video)/",
    "\\buploads/[^\\s\"']+\\.(?:png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?|mp3|wav|m4a|aac|ogg|flac|opus|mp4|mov|webm|mkv|avi)\\b",
    "\\.(?:png|jpe?g|gif|webp|bmp|heic|heif|tiff?|mp3|wav|m4a|aac|ogg|flac|opus|mp4|mov|webm|mkv|avi)\\b",
    "\\b(?:youtu\\.be/|youtube\\.com/(?:watch\\?|shorts/|embed/|live/))",
    "\\b(?:this|the|attached|uploaded)\\s+(?:image|photo|screenshot|picture|diagram|chart|audio|recording|video|clip)\\b",
    "\\btranscribe\\b",
  ].join("|"),
  "i"
);

export function inputSuggestsMultimodal(input) {
  return MULTIMODAL_INPUT_RE.test(String(input || ""));
}

/**
 * Input carries (or references) a ZIP/TAR archive — the `extract_archive` /
 * `archive_list` case. Used to pre-unlock the deferred `archives` group so the
 * agent sees the dedicated extract tool instead of flailing with run_python
 * zipfile (which hits JsProxy/binary errors in Pyodide).
 */
export const ARCHIVE_INPUT_RE =
  /(?:[\w./-]+\.(?:zip|tar\.gz|tgz|tar)(?!\w)(?!\.\w)|\b(?:unzip|extract|decompress)\b[^.!?]{0,40}\b(?:archive|zip|tarball|bundle)\b)/i;

export function inputSuggestsArchive(input) {
  return ARCHIVE_INPUT_RE.test(String(input || ""));
}

/**
 * Input carries (or references) a PDF or DOCX — the `pdf_extract` /
 * `docx_extract` case. Pre-unlocks the deferred `documents` group.
 */
export const DOCUMENT_INPUT_RE = /[\w./-]+\.(?:pdf|docx)(?!\w)(?!\.\w)/i;

export function inputSuggestsDocument(input) {
  return DOCUMENT_INPUT_RE.test(String(input || ""));
}

/**
 * One-shot prefix when the turn references a binary file or media: name the
 * dedicated tool for the type so the agent does not read_file binary bytes,
 * run_python zipfile to extract, or shell out (Nodebox has no POSIX shell).
 */
export function buildFileHandlingContextPrefix(input) {
  const text = String(input || "");
  const archive = inputSuggestsArchive(text);
  const document = inputSuggestsDocument(text);
  const media = inputSuggestsMultimodal(text);
  if (!archive && !document && !media) return null;
  const lines = [
    "[File handling] A file/media reference was detected. Use the dedicated tool for its type — do NOT read_file binary bytes, do NOT shell out (Nodebox has no POSIX shell):",
  ];
  if (archive) {
    lines.push(
      "- ZIP/TAR/TGZ → `extract_archive` (then browse_workspace the output); `archive_list` inspects without extracting. Never run_python zipfile to EXTRACT (os.listdir/binary reads raise JsProxy errors); never read_file the archive."
    );
  }
  if (document) {
    lines.push("- PDF → `pdf_extract`; DOCX → `docx_extract`. Do not read_file these as text.");
  }
  if (media) {
    lines.push(
      "- Image → `vision_analyze` / `image_info`; audio → `audio_analyze`; YouTube URL → `youtube_transcribe`."
    );
  }
  lines.push("Full tool picker: `skill` (action=view) **`browser-runtime-map`**.");
  return lines.join("\n");
}

const PYTHON_SKILL_INSTALL_RE = /\b(pip install|python3?|python\s+-m|\.py\b)\b/i;

const API_CALL_INTENT_RE = new RegExp(
  [
    "\\bgraphql\\b",
    "\\bdirectus\\b",
    "\\brest\\s+api\\b",
    "\\bapi\\s+(call|request|endpoint)\\b",
    "\\bbearer\\b",
    "\\bauthorization\\s*:\\s*bearer",
    "/graphql",
    "\\bhow many\\b[^.!?]{0,40}\\b(posts?|jobs?|items?|records?)\\b",
    "\\bweb_post\\b",
    "\\bweb_fetch\\b",
    "\\bcms\\b",
  ].join("|"),
  "i"
);

export function isApiCallIntent(input) {
  return API_CALL_INTENT_RE.test(String(input || ""));
}

const COMPOSIO_SAAS_INTENT_RE = new RegExp(
  [
    "\\b(linkedin|gmail|google calendar|google sheets|hubspot|notion|slack|twitter|instagram|youtube)\\b",
    "\\bmy\\s+(?:linkedin|gmail|inbox|calendar|slack|twitter|x|instagram|hubspot|notion)\\b",
    "\\b(?:what'?s|whats)\\s+happening\\s+(?:on|in)\\s+my\\b",
    "\\bconnected\\s+(?:app|account|integration)s?\\b",
    "\\bcomposio\\b",
  ].join("|"),
  "i"
);

export function isComposioSaasIntent(input) {
  return COMPOSIO_SAAS_INTENT_RE.test(String(input || ""));
}

/** One-shot prefix before OAuth SaaS / connected-app work. */
export function buildComposioSaasContextPrefix(input) {
  if (!isComposioSaasIntent(input)) return null;
  return (
    "[OAuth SaaS] User query may target a Composio-connected app. Call `skill` (action=view) **`composio-oauth`**, then `composio_status` " +
    "(optionally `{ app: \"linkedin\" }` etc.) before answering about access. If `connected_accounts` includes the app, use `composio_action` — " +
    "do not tell the user to connect OAuth or claim 'no access' without checking status. Offer `composio_connect` only when status shows the app is missing. " +
    "If `configured: false`, tell the user to add `composio_api_key` in Settings — do not web_search or web_fetch GitHub/repo setup docs."
  );
}

/** One-shot prefix before REST/GraphQL work. */
export function buildApiCallContextPrefix(input) {
  if (!isApiCallIntent(input)) return null;
  return (
    "[HTTP API] Call `skill` (action=view) **`http-api`** and any imported skill for this API before the first request. " +
    "GET + Bearer → web_fetch `{ url, headers, response_format: \"api\" }` (never TinyFish). POST/GraphQL → web_post `{ url, body, headers }`. " +
    "Follow the skill's discovery order (health, list metadata, schema) before guessing resource names or GraphQL root fields. " +
    "On validation errors, read `recovery_hint` and fix query shape — do not retry the same malformed call."
  );
}

/** One-shot prefix when installing from curated lists or registries. */
export function buildSkillInstallContextPrefix(input) {
  if (!isSkillInstallIntent(input)) return null;
  let prefix =
    "[Skill install] Some GitHub repos are curated indexes (README + outbound links), not skill hosts. " +
    "For uploaded/extracted skill archives: after `extract_archive` (from `.webagent/telegram-inbox/` when needed), locate the directory containing `SKILL.md`, then `skill` action=manage manage_action=import_dir path=<that-folder> — installs under `.webagent/skills/<category>/<slug>/`, NOT `.webagent/capabilities/skills/`. " +
    "Read the README, follow registry links (officialskills.sh / skills.sh / skillsmp) or source-repo URLs — " +
    "do not guess raw paths from list labels. On 404: web_fetch registry pages, resolve GitHub links, " +
    "try alternate repo layouts, web_search — pivot before declaring a blocker. " +
    "After install, call `skill` (action=view) **`imported-skill-compat`**, then `skill` (action=view) the installed skill; follow the Web Agent execution section.";
  if (PYTHON_SKILL_INSTALL_RE.test(String(input || ""))) {
    prefix +=
      " After install, if the skill references Python, pip, or HTTP clients: use `run_python` for compatible Python, call `skill` (action=view) **`http-api`** for REST/GraphQL, use `web_fetch`/`web_post` for simple API steps, and avoid system pip/native shell assumptions.";
  }
  return prefix;
}

export const SKILL_INSTALL_PIVOT_NUDGE =
  "Skill install pivot: your last `skill` (action=bulk) had all URL failures. " +
  "Do not stop yet. Re-read the list README for registry or source-repo links, web_fetch those pages, " +
  "resolve to real SKILL.md URLs, then retry. If still stuck, web_search for the skill on skills.sh or GitHub.";

export function isRegistrySkillUrl(url) {
  const raw = String(url || "").trim().toLowerCase();
  if (!raw) return false;
  return (
    raw.includes("officialskills.sh") ||
    /(?:^|\/)skills\.sh\//.test(raw) ||
    raw.includes("skillsmp.com")
  );
}

export function skillBulkSaveAllUrlItemsFailed(exec) {
  if (!Array.isArray(exec)) return false;
  for (const item of exec) {
    const tool = String(item?.tool ?? "");
    const args =
      item?.arguments && typeof item.arguments === "object" && !Array.isArray(item.arguments)
        ? item.arguments
        : {};
    const isBulk =
      tool === "skill_bulk_save" ||
      (tool === "skill" && String(args.action || "").toLowerCase() === "bulk");
    if (!isBulk) continue;
    const result = item?.result;
    if (!result || typeof result !== "object") return false;
    const summary = result.summary;
    if (!summary || typeof summary !== "object") return false;
    const saved = Number(summary.saved ?? 0);
    const failed = Number(summary.failed ?? 0);
    const blocked = Number(summary.blocked ?? 0);
    return saved === 0 && failed + blocked > 0;
  }
  return false;
}

export function webFetchTargetsRegistryUrl(tools, exec) {
  if (!Array.isArray(tools) || !Array.isArray(exec)) return false;
  for (let i = 0; i < tools.length; i++) {
    if (String(tools[i]?.name ?? "") !== "web_fetch") continue;
    const item = exec[i];
    if (item?.error) continue;
    const args =
      tools[i]?.arguments && typeof tools[i].arguments === "object"
        ? tools[i].arguments
        : {};
    const urls = [];
    if (typeof args.url === "string") urls.push(args.url);
    if (Array.isArray(args.urls)) urls.push(...args.urls.map(String));
    if (urls.some((u) => isRegistrySkillUrl(u))) return true;
  }
  return false;
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
  /(?:\btest(?:ing|s)?\b|re-?test|\btry\b|continue testing|one\s+(?:by|bye|bie)\s+one|systematically|\ball tools\b|tool tests|sequentially|without stopping)/;

const EXECUTION_CONTINUATION_INTENT_RE =
  /\b(?:continue\s+until(?:\s+completion)?|^\s*continue\s*[.!?]?\s*$|^\s*(?:resume|keep\s+going|carry\s+on|go\s+on|pick\s+up(?:\s+where(?:\s+we\s+left\s+off)?)?)\s*[.!?]?\s*$|(?:shall|should|let's|lets)\s+we\s+continue\b|(?:shall|should|let's|lets)\s+continue\b|continue\s+(?:the|this|that|with|installing|working|where)\b|keep\s+installing\b|finish\s+installing\b|go\s+ahead|don't\s+pause|do\s+not\s+pause|no\s+more\s+pauses?|^\s*(?:start|yes|ok|okay|proceed|do\s+it|run\s+it|execute)\s*[.!?]?\s*$|plan\s+approved|approved\s+plan|execute\s+(?:the\s+)?(?:plan|audit|pipeline)|proceed\s+with\s+(?:the\s+)?(?:plan|execution|audit)|start\s+(?:the\s+)?(?:plan|audit|pipeline)|run\s+(?:the\s+)?(?:plan|audit|pipeline))\b/i;

/** One-shot prefix when the user is resuming prior work (Continue / resume / keep going). */
export function buildExecutionContinuationContextPrefix(input) {
  if (!isExecutionContinuationIntent(input)) return null;
  return (
    "[Continuation] The user is resuming prior work—not starting a new task. " +
    "Do not stop after narration or a single search; call tools until the task is complete or you hit a real blocker. " +
    "For skill installs or find-skills hunts, continue searching and installing remaining targets without asking permission again. " +
    "Use find_files with patterns: [\"token1\",\"token2\"] (all must match) or grep for content search."
  );
}

function isToolSequenceIntent(input) {
  return TOOL_SEQUENCE_USER_INTENT_RE.test(String(input || "").toLowerCase());
}

/** Short approval/continuation replies — not new multi-step planning tasks. */
export function isExecutionContinuationIntent(input) {
  return EXECUTION_CONTINUATION_INTENT_RE.test(String(input || "").trim());
}

function estimateTaskStepsFromInput(input) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return 1;
  if (isExecutionContinuationIntent(text)) return 1;

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
  /\b(plan\s+is\s+approved|plan\s+approved|approved\s+plan|approve(?:d)?\s+(?:the\s+)?plan|execute\s+(?:the\s+)?(?:plan|audit|pipeline)|proceed\s+with\s+(?:the\s+)?(?:plan|execution|audit)|start\s+(?:the\s+)?(?:plan|audit|pipeline)|run\s+(?:the\s+)?(?:plan|audit|pipeline)|^\s*(?:start|go\s+ahead|do\s+it|run\s+it|yes|ok|okay)\s*[.!?]?\s*$|continue\s+until(?:\s+completion)?)\b/i;

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
