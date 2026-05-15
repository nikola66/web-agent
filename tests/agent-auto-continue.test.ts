import test from "node:test";
import assert from "node:assert/strict";

import {
  isExplicitSequenceCompletion,
  isToolSequenceIntent,
  repairExactResponseText,
  shouldAutoContinueActionPlan,
  shouldAutoContinueAfterToolUse,
  shouldAutoContinueStrict,
  shouldTreatPostToolTextAsFinal,
  shouldAutoContinueToolSequence,
  shouldSuppressActionPlanAutoContinue,
  isSchedulingAutomationIntent,
  shouldNudgeIncompleteSchedulingReply,
} from "../dist/agent-runtime/turn-sequencing.js";
import { getAutoContinueNudgeState } from "../dist/agent-runtime/auto-continue.js";

const TOOL_NAMES = [
  "make_dir",
  "write_file",
  "edit_file",
  "multi_edit",
  "apply_patch",
  "list_dir",
  "find_files",
  "grep",
  "tree",
  "delete_file",
  "move_file",
  "run_shell",
  "web_search",
  "web_fetch",
  "memory_save",
  "memory_recall",
  "memory_search",
  "todo_write",
];

test("auto-continue matches transcript style: Test N with normalized tool alias", () => {
  const input = "Cool let's repeat all the tools tests. List all tools then test one by one don't stop until completion";
  const visible = "Test 2: writefile - create testdir/subdir1/file1.txt with content";
  assert.equal(shouldAutoContinueToolSequence(input, visible, TOOL_NAMES), true);
});

test("auto-continue matches step phrasing with underscore tool name", () => {
  const input = "Test all tools systematically and continue testing";
  const visible = "Step 3: now testing run_shell with pwd";
  assert.equal(shouldAutoContinueToolSequence(input, visible, TOOL_NAMES), true);
});

test("auto-continue matches running tool N phrasing", () => {
  const input = "Test tools one by one until completion";
  const visible = "Running tool 5 — invoking grep for TODO markers across src/";
  assert.equal(shouldAutoContinueToolSequence(input, visible, TOOL_NAMES), true);
});

test("auto-continue is false when user intent is not a testing sequence", () => {
  const input = "Summarize this file";
  const visible = "Next I'll test write_file";
  assert.equal(shouldAutoContinueToolSequence(input, visible, TOOL_NAMES), false);
});

test("auto-continue is false when assistant text is not a test step", () => {
  const input = "test tools one by one";
  const visible = "Here are the final results.";
  assert.equal(shouldAutoContinueToolSequence(input, visible, TOOL_NAMES), false);
});

test("sequence intent detects one-by-one completion requests", () => {
  const input = "List all tools and test them one by one without stopping until completion";
  assert.equal(isToolSequenceIntent(input), true);
});

test("sequence intent matches one bye one typo", () => {
  assert.equal(isToolSequenceIntent("test tools one bye one"), true);
});

test("sequence intent matches testing gerund", () => {
  assert.equal(isToolSequenceIntent("list tools then start testing them"), true);
});

test("explicit completion detector matches done-style messages", () => {
  const visible = "Great, all tools tested. Testing complete.";
  assert.equal(isExplicitSequenceCompletion(visible), true);
});

test("post-tool nudge fires on 'I'll keep reading' commitment", () => {
  const visible = "I'll keep reading the search snapshots to compile the research.";
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge fires on 'Let me check the next file'", () => {
  const visible = "Let me check the next file before answering.";
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge fires on smart-quote apostrophe in I'll", () => {
  const visible = "I\u2019ll continue investigating the snapshots.";
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge fires on empty visible after tool execution", () => {
  assert.equal(shouldAutoContinueAfterToolUse(""), true);
  assert.equal(shouldAutoContinueAfterToolUse("   \n  "), true);
});

test("post-tool nudge fires on trailing colon ('Next steps:')", () => {
  const visible = "Next steps:";
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge skips when assistant signals completion", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("Done. Here's the summary: …"),
    false
  );
  assert.equal(
    shouldAutoContinueAfterToolUse("All tasks complete."),
    false
  );
  assert.equal(
    shouldAutoContinueAfterToolUse("In conclusion, the README explains the install steps."),
    false
  );
});

test("post-tool nudge skips when assistant asks the user a question", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("Which snapshot should I open next?"),
    false
  );
  assert.equal(
    shouldAutoContinueAfterToolUse("Would you like me to keep reading the rest?"),
    false
  );
});

test("post-tool nudge skips on plain answer without commitment language", () => {
  const visible = "The README contains install steps for Linux and macOS.";
  assert.equal(shouldAutoContinueAfterToolUse(visible), false);
});

test("post-tool nudge does not match standalone word 'ill'", () => {
  // Regression guard for the previous brittle `i('| a)?ll` regex which would
  // false-match "ill" / "still" inside other words.
  assert.equal(
    shouldAutoContinueAfterToolUse("She felt ill after the trip."),
    false
  );
});

test("action-plan detector now accepts 'I'll keep reading'", () => {
  const input = "Compile research from the search snapshots.";
  const visible = "I'll keep reading the search snapshots to compile the research.";
  assert.equal(shouldAutoContinueActionPlan(input, visible), true);
});

test("action-plan detector still skips conversational asks", () => {
  const input = "Should I go with option A or B?";
  const visible = "Which one would you prefer?";
  assert.equal(shouldAutoContinueActionPlan(input, visible), false);
});

test("post-tool nudge fires on 'Next: list contents…' step header (regression for transcript)", () => {
  const visible = "Next: list contents of ./projects/hermes to confirm file presence and plan edits.";
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge fires on 'Now: read the file' step header", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("Now: read the file at projects/hermes/HERMES_RESEARCH.md."),
    true
  );
});

test("post-tool nudge fires on 'Then: parse the JSON' step header", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("Then: parse the JSON snapshot to extract feature names."),
    true
  );
});

test("post-tool nudge fires on numbered step headers ('Step 3: …')", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("Step 3: open the next snapshot."),
    true
  );
});

test("post-tool nudge fires on markdown heading 'Next: …'", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("### Next: list contents of the directory"),
    true
  );
});

test("post-tool nudge fires on bulleted 'Next: …'", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("- Next: read run_1778369809635.json"),
    true
  );
  assert.equal(
    shouldAutoContinueAfterToolUse("* Next: keep reading"),
    true
  );
});

test("post-tool nudge fires on transcript-style multi-line summary ending with 'Next:' header", () => {
  // Mirrors the user's failing transcript almost verbatim.
  const visible = [
    "Add: project directories ./projects/hermes and ./projects/browser-tools created.",
    "",
    "Todo list added.",
    "",
    "Web search performed for \"Hermes agent top features\" — retrieved summary snapshot.",
    "",
    "Created file ./projects/hermes/HERMES_RESEARCH.md with preliminary findings.",
    "",
    "Next: list contents of ./projects/hermes to confirm file presence and plan edits.",
  ].join("\n");
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge does NOT match prose containing 'next' inline", () => {
  // 'next' inside a sentence should not be treated as a step header.
  assert.equal(
    shouldAutoContinueAfterToolUse(
      "The next snapshot in the dataset documents Hermes context handling."
    ),
    false
  );
});

test("action-plan detector accepts 'Next: list contents…'", () => {
  const input = "Research the project and produce notes.";
  const visible = "Next: list contents of ./projects/hermes.";
  assert.equal(shouldAutoContinueActionPlan(input, visible), true);
});

test("action-plan detector accepts transcript 'First, researching …' after Round heading", () => {
  const input =
    "For 5 rounds, research a topic, write summary, translate, save markdown file.";
  const visible =
    "Round 1: Agentic AI Orchestration (The Shift from Chatbots to Agents)\n\nFirst, researching the current state of Agentic Orchestration.";
  assert.equal(shouldAutoContinueActionPlan(input, visible), true);
});

test("action-plan detector accepts 'Round N: …' section header", () => {
  const input = "Repeat until you have 5 articles.";
  const visible = "Round 2: Quantum Networking\n\nI'll gather sources next.";
  assert.equal(shouldAutoContinueActionPlan(input, visible), true);
});

test("action-plan detector does not treat inline 'first,' as a step header", () => {
  const input = "Summarize the README.";
  const visible =
    "The README explains setup first, then lists dependencies. Here is the overview.";
  assert.equal(shouldAutoContinueActionPlan(input, visible), false);
});

test("post-tool nudge fires on 'First, researching …' transcript line", () => {
  const visible =
    "Round 1: Agentic AI Orchestration\n\nFirst, researching the current state of Agentic Orchestration.";
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge fires on 'Round N Topic: …' and I'm diving …", () => {
  const visible = [
    "Round 2 Topic: The Role of Memory in Autonomous Agents (Short-term vs. Long-term/RAG).",
    "",
    "I'm diving into the research now. Stand by.",
  ].join("\n");
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("post-tool nudge fires on Hermes-style 'Round N (Breadth): …' header", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse(
      "Round 1 (Breadth): fan out parallel web_search queries across regions and platforms."
    ),
    true
  );
});

test("post-tool nudge fires on 'Phase N: …' step header", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("Phase 2: validate the proxy configuration against staging URLs."),
    true
  );
});

test("post-tool nudge fires on apostrophe-less Im going commitment", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse("Im going to open the next snapshot and trace the form action."),
    true
  );
});

test("strict post-tool continue accepts We've read observation", () => {
  assert.equal(
    shouldAutoContinueStrict(
      "We've read run_789.json — the snapshot lists three outbound URLs worth fetching next."
    ),
    true
  );
});

test("post-tool nudge does not treat inline Phase mention as line-start header", () => {
  assert.equal(
    shouldAutoContinueAfterToolUse(
      "We will tackle Phase 2 only after Phase 1 passes CI."
    ),
    false
  );
});

test("strict post-tool continue still skips inline Phase prose without observation verb", () => {
  assert.equal(
    shouldAutoContinueStrict("Phase 2 is riskier because it touches authentication."),
    false
  );
});

test("research incomplete does not block strict post-tool recovery nudge", () => {
  const state = getAutoContinueNudgeState({
    turnInput: "Continue research.",
    visible:
      "I've read memory/snapshots/run_999.json — it expands into multiple channels we still need to web_fetch before concluding.",
    executedToolsInTurn: true,
    autoContinueNudges: 0,
    maxNudges: 20,
    toolNames: TOOL_NAMES,
    originalUserInput:
      "Find YouTube creators posting about mechanical keyboards in Germany",
    suppressActionPlanNudge: false,
    webSearchCount: 6,
    webFetchCount: 0,
  });
  assert.equal(state.shouldNudge, true);
  assert.equal(state.reason, "research_incomplete");
});

test("getAutoContinueNudgeState returns scheduling_automation for cron intent and incomplete reply", () => {
  const state = getAutoContinueNudgeState({
    turnInput: "Set up a daily digest via cron.",
    visible: "I can help automate that.",
    executedToolsInTurn: false,
    autoContinueNudges: 0,
    maxNudges: 20,
    toolNames: TOOL_NAMES,
    originalUserInput:
      "Register a recurring job using .cronjobs.json — run every day at 9am.",
    suppressActionPlanNudge: false,
    webSearchCount: 0,
    webFetchCount: 0,
  });
  assert.equal(state.shouldNudge, true);
  assert.equal(state.reason, "scheduling_automation");
});

test("post-tool nudge fires when milestone 'completed round' mixes with next-round intent", () => {
  const visible = [
    "I have completed the second round of research and documentation.",
    "",
    "Round 2: AI Safety & Governance in Autonomous Agents",
    "",
    "Current Progress: 2/5 Rounds Complete.",
    "",
    "I am now proceeding to Round 3, focusing on Open-Source Agent Frameworks.",
    "I'll start by researching the latest benchmarks for SLMs in agentic roles.",
  ].join("\n");
  assert.equal(shouldAutoContinueAfterToolUse(visible), true);
});

test("strict post-tool continue accepts milestone plus proceeding / I'll research", () => {
  const visible = [
    "I have completed the second round of research and documentation.",
    "I am now proceeding to Round 3.",
    "I'll start by researching the latest benchmarks for SLMs.",
  ].join("\n");
  assert.equal(shouldAutoContinueStrict(visible), true);
});

test("post-tool nudge skips completion-only round milestone", () => {
  assert.equal(shouldAutoContinueAfterToolUse("I have completed round 2. Done."), false);
});

test("strict post-tool continue skips completion-only round milestone", () => {
  assert.equal(shouldAutoContinueStrict("I have completed round 2. Done."), false);
});

test("strict post-tool continue accepts 'First, researching …' (forward-looking)", () => {
  const visible = "First, researching the current state.";
  assert.equal(shouldAutoContinueStrict(visible), true);
});

test("post-tool nudge does not match inline 'round 3' mid-prose", () => {
  const visible =
    "We already finished round 2 yesterday; today we only verify links.";
  assert.equal(shouldAutoContinueAfterToolUse(visible), false);
});

test("strict post-tool continue does not match inline round mention", () => {
  const visible = "Skipping round 4 because the source timed out.";
  assert.equal(shouldAutoContinueStrict(visible), false);
});

test("strict post-tool continue fires on plain narration without commitment", () => {
  // The strict mode (Tier 3) must catch cases the regex-based heuristic
  // misses — e.g. the model reads a file and only narrates an observation,
  // without ever announcing what it'll do next.
  const visible = "I read run_1778369809635.json — the snapshot is the AskQuestion test fixture.";
  assert.equal(shouldAutoContinueStrict(visible), true);
});

test("strict post-tool continue fires on contracted I've read / I've reviewed (regression)", () => {
  assert.equal(
    shouldAutoContinueStrict("I've read the snapshot — it contains the HTML body."),
    true
  );
  assert.equal(
    shouldAutoContinueStrict("I\u2019ve read the file at memory/snapshots/run_123_r1_0.json."),
    true
  );
  assert.equal(
    shouldAutoContinueStrict("I've reviewed the HTML from the snapshot; here is my take."),
    true
  );
});

test("strict post-tool continue still respects completion signals", () => {
  assert.equal(shouldAutoContinueStrict("All tasks complete."), false);
  assert.equal(shouldAutoContinueStrict("Done — here is the summary: foo."), false);
  assert.equal(shouldAutoContinueStrict("In conclusion, the project is healthy."), false);
});

test("strict post-tool continue still respects user-facing questions", () => {
  assert.equal(
    shouldAutoContinueStrict("Which snapshot should I open next?"),
    false
  );
  assert.equal(
    shouldAutoContinueStrict("Would you like me to keep reading the rest?"),
    false
  );
});

test("strict post-tool continue treats empty assistant text as continue", () => {
  assert.equal(shouldAutoContinueStrict(""), true);
  assert.equal(shouldAutoContinueStrict("   \n  "), true);
});

test("strict post-tool continue stops on direct final action answers", () => {
  assert.equal(
    shouldAutoContinueStrict("I've created fastapi_project/main.py with the FastAPI app."),
    false
  );
});

test("post-tool final guard stops on direct answer before stale extra tool", () => {
  assert.equal(
    shouldTreatPostToolTextAsFinal(
      "There is currently no active war between the UAE and Iran - the latest reporting focuses on longstanding territorial disputes and regional tensions rather than direct military conflict."
    ),
    true
  );
});

test("post-tool final guard ignores model control tokens", () => {
  assert.equal(shouldTreatPostToolTextAsFinal("<|channel>"), false);
});

test("post-tool final guard still lets forward-looking tool work continue", () => {
  assert.equal(
    shouldTreatPostToolTextAsFinal("Let me read the next result before answering."),
    false
  );
  assert.equal(
    shouldTreatPostToolTextAsFinal("I'll continue reading the search snapshots to compile the research."),
    false
  );
});

test("topic pivot: explicit lead-in suppresses action-plan auto-continue gate", () => {
  const prev = "Generate a PDF of the SEO plan and email it.";
  assert.equal(
    shouldSuppressActionPlanAutoContinue("Instead, set up a daily LLM news digest at 9am.", prev),
    true
  );
  assert.equal(
    shouldSuppressActionPlanAutoContinue("Forget that — list open issues only.", prev),
    true
  );
});

test("topic pivot: low overlap suppresses; retry same task does not", () => {
  const prev = "You're right, send the SEO audit as a PDF attachment via email.";
  assert.equal(
    shouldSuppressActionPlanAutoContinue(
      "Every morning I need a full report on latest LLM and open-weight model news in chat at 9am.",
      prev
    ),
    true
  );
  assert.equal(shouldSuppressActionPlanAutoContinue("Try again", prev), false);
  assert.equal(shouldSuppressActionPlanAutoContinue("Please retry", prev), false);
});

test("topic pivot: tool-sequence requests are never suppressed", () => {
  const prev = "Summarize the README.";
  const seq =
    "List every tool and test them one by one without stopping until completion.";
  assert.equal(shouldSuppressActionPlanAutoContinue(seq, prev), false);
});

test("repairs exact response tokens when model strips underscores", () => {
  assert.equal(
    repairExactResponseText(
      "Reply with exactly LIVE_DIRECT_OK_TOKEN and no other words.",
      "LIVEDIRECTOK_TOKEN"
    ),
    "LIVE_DIRECT_OK_TOKEN"
  );
  assert.equal(
    repairExactResponseText(
      "Give one final sentence ending with LIST_DONE_TOKEN.",
      "Project files are listed - LISTDONETOKEN"
    ),
    "Project files are listed - LIST_DONE_TOKEN"
  );
});

test("scheduling automation intent matches cron and daily digest phrasing", () => {
  assert.equal(
    isSchedulingAutomationIntent(
      "I need your help setting up cronjobs that run every morning to send me new ideas for our blog"
    ),
    true
  );
  assert.equal(isSchedulingAutomationIntent("Please add a daily digest of errors from the log."), true);
  assert.equal(isSchedulingAutomationIntent("Summarize this README for me."), false);
});

test("scheduling incomplete-reply nudge skips questions and completion", () => {
  assert.equal(shouldNudgeIncompleteSchedulingReply(""), true);
  assert.equal(shouldNudgeIncompleteSchedulingReply("messages."), true);
  assert.equal(shouldNudgeIncompleteSchedulingReply("What timezone are you in?"), false);
  assert.equal(shouldNudgeIncompleteSchedulingReply("Done. Here's the summary."), false);
});
