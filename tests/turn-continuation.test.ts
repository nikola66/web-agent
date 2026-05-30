import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeCodexIntermediateAck,
  looksLikeEmptyAfterTools,
  looksLikeFalseManualCronPromise,
  looksLikePostToolStall,
  looksLikePreToolPromiseStall,
  looksLikeEmptyResponse,
  looksLikeTruncatedResponse,
  matchesFutureActionIntent,
  matchesUserInputRequest,
  matchesTaskCompletionOrFinalState,
  shouldSuppressContinuationNudge,
  hasToolContextInConversation,
  buildContinuationNudge,
  shouldContinueIntermediateAck,
  shouldContinueEmptyAfterTools,
  shouldContinueEmptyResponse,
  shouldContinueTruncation,
  shouldContinuePostToolStall,
  shouldContinuePreToolPromiseStall,
  shouldDeferTruncatedContentToolExecution,
  partitionToolsForTruncatedContentDeferral,
  isDeferrableTruncatedContentTool,
  resolveTurnStopReason,
  shouldContinueCronVerification,
  shouldContinueIncompleteTodos,
  shouldContinueIncompletePublishDeliverable,
  shouldContinueContentShareDeliverable,
  shouldContinueUnparsedToolMarkup,
  buildContentShareContinuationNudge,
  buildContentShareFallbackVisible,
  shouldApplyContentShareFallback,
  userRequestedContentShare,
  contentShareDeliverableSatisfied,
  visibleContainsReadFileContent,
  userRequestedArticlePublish,
  articleDraftWrittenInTurn,
  publishDeliverableCompleted,
  MAX_INCOMPLETE_PUBLISH_CONTINUATIONS,
  MAX_CONTENT_SHARE_CONTINUATIONS,
  MAX_UNPARSED_TOOL_MARKUP_CONTINUATIONS,
  userRequestedStructuredTodos,
  cronRegisterJobIdFromArgs,
  cronJobIdsFromListResult,
  MAX_INTERMEDIATE_ACK_CONTINUATIONS,
  MAX_POST_TOOL_STALL_CONTINUATIONS,
  MAX_PRE_TOOL_PROMISE_CONTINUATIONS,
  MAX_EMPTY_RESPONSE_CONTINUATIONS,
  MAX_TRUNCATION_CONTINUATIONS,
  looksLikeFindSkillsDeliveryStall,
  shouldContinueFindSkillsDelivery,
} from "../dist/agent-runtime/turn-continuation.js";

const NO_TOOLS: never[] = [];

test("looksLikeCodexIntermediateAck matches Hermes workspace + future ack pattern", () => {
  assert.equal(
    looksLikeCodexIntermediateAck(
      "check the repo readme",
      "I'll read the file in the project and summarize it.",
      NO_TOOLS,
      false
    ),
    true
  );
});

test("looksLikeCodexIntermediateAck rejects without workspace context", () => {
  assert.equal(
    looksLikeCodexIntermediateAck(
      "find SEO skills online",
      "I'll search for the best skills and summarize them.",
      NO_TOOLS,
      false
    ),
    false
  );
});

test("looksLikeCodexIntermediateAck rejects after tool context in turn", () => {
  const conv = [{ role: "user", content: "Tool results (compact JSON):\n[]" }];
  assert.equal(
    looksLikeCodexIntermediateAck(
      "hunt leads",
      "Give me the list of domains and I'll start pulling contacts.",
      conv,
      true
    ),
    false
  );
  assert.equal(hasToolContextInConversation(conv, true), true);
});

test("looksLikeCodexIntermediateAck rejects long assistant text", () => {
  assert.equal(
    looksLikeCodexIntermediateAck(
      "check /workspace",
      `${"x".repeat(1300)} I'll read the file.`,
      NO_TOOLS,
      false
    ),
    false
  );
});

test("looksLikeEmptyAfterTools detects empty post-tool responses", () => {
  assert.equal(looksLikeEmptyAfterTools("", true), true);
  assert.equal(looksLikeEmptyAfterTools("Done.", true), false);
});

test("buildContinuationNudge matches Hermes recovery text", () => {
  assert.match(buildContinuationNudge("intermediate_ack"), /Continue now/i);
  assert.match(buildContinuationNudge("empty_after_tools"), /empty response/i);
  assert.match(buildContinuationNudge("empty_response"), /empty response/i);
});

test("shouldContinueIntermediateAck respects cap", () => {
  assert.equal(
    shouldContinueIntermediateAck(
      "check repo",
      "I'll read the file.",
      NO_TOOLS,
      false,
      MAX_INTERMEDIATE_ACK_CONTINUATIONS
    ),
    false
  );
});

test("shouldContinueEmptyAfterTools respects cap", () => {
  assert.equal(shouldContinueEmptyAfterTools("", true, 1), false);
});

test("looksLikePostToolStall detects promise-only post-tool responses", () => {
  assert.equal(
    looksLikePostToolStall(
      "Since you want me to continue, I'll start by searching for high-growth companies.",
      true
    ),
    true
  );
});

test("looksLikePostToolStall rejects user-input prompts", () => {
  assert.equal(
    looksLikePostToolStall("Give me the list of domains and I'll start pulling contacts.", true),
    false
  );
});

test("looksLikePostToolStall detects false manual cron promise", () => {
  const text =
    "The job was refreshed and is on its 120-minute countdown. However, why wait for the timer? I'll kick off a manual run of the outreach-hunter skill right now.";
  assert.equal(looksLikeFalseManualCronPromise(text), true);
  assert.equal(looksLikePostToolStall(text, true), true);
  assert.equal(shouldContinuePostToolStall(text, true, 0), true);
  assert.match(
    buildContinuationNudge("post_tool_stall", { falseManualCron: true }),
    /no manual cron run/i
  );
});

test("looksLikePostToolStall continues when agent picks from findings then I'll fetch", () => {
  const text = `Found a goldmine. jscraik/unfinished-cemetery.

I'm going to dive into the unfinished-cemetery repo, pick one of the documented dead projects from its archive, and then execute the full excavation procedure on that specific target.

Step 1: Surface Mapping (The Perimeter) begins now. I'll fetch the cemetery's contents to pick a victim.`;
  assert.equal(looksLikePostToolStall(text, true), true);
  assert.equal(shouldContinuePostToolStall(text, true, 0), true);
});

test("matchesUserInputRequest ignores agent self-selection pick one of", () => {
  assert.equal(
    matchesUserInputRequest("I'll pick one of the documented projects from the archive."),
    false
  );
  assert.equal(matchesUserInputRequest("Pick one: fintech outreach or general SaaS?"), true);
});

test("shouldContinuePostToolStall respects cap", () => {
  assert.equal(
    shouldContinuePostToolStall("I'll search for the positioning first.", true, MAX_POST_TOOL_STALL_CONTINUATIONS),
    false
  );
});

test("looksLikePostToolStall detects I'm going to search after tools", () => {
  assert.equal(
    looksLikePostToolStall(
      "Since I don't have the value prop, I'm going to search for any internal docs or previous memories.",
      true
    ),
    true
  );
});

test("looksLikePreToolPromiseStall detects research promise without workspace paths", () => {
  assert.equal(
    looksLikePreToolPromiseStall(
      "First, I'll search for a list of trending AI Agent startups to get a high-quality seed list.",
      NO_TOOLS,
      false
    ),
    true
  );
});

test("looksLikePreToolPromiseStall rejects when asking user for input", () => {
  assert.equal(
    looksLikePreToolPromiseStall(
      "Give me the list of domains and I'll start pulling contacts.",
      NO_TOOLS,
      false
    ),
    false
  );
});

test("shouldContinuePreToolPromiseStall respects cap", () => {
  assert.equal(
    shouldContinuePreToolPromiseStall(
      "I'll search for companies in the target niche.",
      NO_TOOLS,
      false,
      MAX_PRE_TOOL_PROMISE_CONTINUATIONS
    ),
    false
  );
});

test("buildContinuationNudge includes post-tool stall recovery", () => {
  assert.match(buildContinuationNudge("post_tool_stall"), /continue now/i);
});

test("matchesFutureActionIntent covers common English commitment phrases", () => {
  const shouldMatch = [
    "I'll start by searching the workspace.",
    "I'm going to hunt for target domains.",
    "I'll begin by reading the plan file.",
    "I have to find at least 10 companies first.",
    "I need to research the ICP before we scrape.",
    "I'm about to run a web search for fintech startups.",
    "I'm ready to dive in and explore the repo.",
    "I'm planning to inspect the outreach plan next.",
    "Let me check memory for prior Ainex notes.",
    "Allow me to fetch the latest stakeholder list.",
    "Go ahead and search for Series B automation companies.",
    "First, I'll pull a seed list from internal docs.",
    "Next, I'll dig into session memory for context.",
    "Then I'll compile a list of 10 domains.",
    "I'll proceed to verify each company website.",
    "I'll kick off the domain hunt now.",
    "I've got to track down their positioning pages.",
    "I must validate these domains before Hunter.io.",
    "I should search for AI agent startups in fintech.",
  ];
  for (const phrase of shouldMatch) {
    assert.equal(matchesFutureActionIntent(phrase), true, phrase);
  }
});

test("matchesFutureActionIntent rejects non-commitment phrasing", () => {
  const shouldReject = [
    "",
    "Done — here are the 10 domains.",
    "The plan file is empty.",
    "Would you like me to search?",
  ];
  for (const phrase of shouldReject) {
    assert.equal(matchesFutureActionIntent(phrase), false, phrase);
  }
});

test("looksLikePostToolStall covers expanded future-intent + action pairs", () => {
  const cases = [
    "I'll begin by researching high-growth fintech companies.",
    "I have to gather at least 10 target domains before Hunter.io.",
    "I'm about to fetch a seed list from the web.",
    "Go ahead and compile the initial ICP shortlist.",
    'Trying a wider search for any "Ainex" or "outreach" files.',
    "Let's get back into the Ainex sales outreach plan and finish up those assets.",
  ];
  for (const text of cases) {
    assert.equal(looksLikePostToolStall(text, true), true, text);
  }
});

test("looksLikePreToolPromiseStall covers let's resume phrasing without tools", () => {
  assert.equal(
    looksLikePreToolPromiseStall(
      "Let's get back into the Ainex sales outreach plan and finish up those assets.",
      NO_TOOLS,
      false
    ),
    true
  );
});

test("looksLikePostToolStall still rejects ask-first tails", () => {
  assert.equal(
    looksLikePostToolStall("I need to ask you for the target niche before I search.", true),
    false
  );
});

test("matchesUserInputRequest covers common ask / decide / choose patterns", () => {
  const shouldMatch = [
    "Give me the list of domains and I'll start pulling contacts.",
    "Please provide the target niche before I begin research.",
    "What would you like me to focus on first?",
    "Which option should I take: Hunter.io now or build the ICP first?",
    "Shall I proceed with the fintech niche or wait for your approval?",
    "Do you want me to search internal docs or start with web research?",
    "Can you clarify what Ainex's core value proposition is?",
    "I need more information about your ICP before I can hunt domains.",
    "Let me know which segment you prefer.",
    "Your call — enterprise SaaS or high-growth fintech?",
    "Pick one: A) scrape contacts now B) refine ICP first.",
    "Please confirm before I run the Hunter.io lookup.",
    "Reply with the niche you want me to target.",
    "Would you prefer I start with memory_search or web_search?",
    "I'm missing details on the value prop — could you share that?",
    "Before I proceed, which geography should I prioritize?",
    "Option 1: internal docs. Option 2: web research. Which do you want?",
    "Up to you — should I draft the ICP or hunt domains first?",
  ];
  for (const phrase of shouldMatch) {
    assert.equal(matchesUserInputRequest(phrase), true, phrase);
  }
});

test("matchesUserInputRequest rejects pure action promises", () => {
  const shouldReject = [
    "I'll search for AI agent startups in fintech.",
    "I'm going to compile a list of 10 target domains.",
    "Let me check the outreach plan and report back.",
    "Done — here are the domains you asked for.",
  ];
  for (const phrase of shouldReject) {
    assert.equal(matchesUserInputRequest(phrase), false, phrase);
  }
});

test("looksLikePreToolPromiseStall rejects expanded ask patterns", () => {
  assert.equal(
    looksLikePreToolPromiseStall(
      "Which niche should I target? I'll search once you confirm fintech vs SaaS.",
      NO_TOOLS,
      false
    ),
    false
  );
});

test("looksLikeCodexIntermediateAck rejects when asking user even with workspace context", () => {
  assert.equal(
    looksLikeCodexIntermediateAck(
      "check projects/ainex/outreach_plan.md",
      "What should I put in the ICP field? Give me the value prop and I'll fill the plan.",
      NO_TOOLS,
      false
    ),
    false
  );
});

test("matchesTaskCompletionOrFinalState covers conclusions, blockers, and wrap-up", () => {
  const shouldMatch = [
    "Task complete. Here are the 10 target domains.",
    "Research finished — final list below.",
    "Here's the final shortlist of companies for outreach.",
    "In summary, these are the best-fit targets.",
    "Bottom line: we can't proceed without a Hunter.io API key.",
    "The blocker is the missing Ainex value proposition.",
    "Unable to proceed without internal positioning docs.",
    "That completes the domain hunt for this phase.",
    "All set — ready for your review.",
    "Nothing else needed on my side.",
    "Done. Let me know if you'd like me to run Hunter.io next.",
    "Here are your 10 companies:",
  ];
  for (const phrase of shouldMatch) {
    assert.equal(matchesTaskCompletionOrFinalState(phrase), true, phrase);
  }
});

test("matchesTaskCompletionOrFinalState rejects in-progress promises", () => {
  const shouldReject = [
    "I'll search for companies next.",
    "I'm going to compile the list now.",
  ];
  for (const phrase of shouldReject) {
    assert.equal(matchesTaskCompletionOrFinalState(phrase), false, phrase);
  }
});

test("shouldSuppressContinuationNudge blocks completion but not chained next steps", () => {
  assert.equal(
    shouldSuppressContinuationNudge(
      "Domain hunt complete. Here are the 10 targets you asked for."
    ),
    true
  );
  assert.equal(
    shouldSuppressContinuationNudge(
      "Research complete. I'll now run Hunter.io to find stakeholders."
    ),
    false
  );
  assert.equal(
    shouldSuppressContinuationNudge(
      "Every raw URL is 404. I'm done guessing. I'm going to use web_search to find design-md. If that fails, we pivot."
    ),
    false
  );
});

test("looksLikePostToolStall nudges skill-install pivot promise after bulk 404s", () => {
  const text =
    "Every single raw URL is 404ing. I'm done guessing. I'm going to use web_search to find the actual raw content. If I can't find that one, we pivot.";
  assert.equal(looksLikePostToolStall(text, true), true);
  assert.equal(shouldContinuePostToolStall(text, true, 0), true);
});

test("looksLikePostToolStall rejects final deliverables and blockers", () => {
  const cases = [
    "Search complete. Here are the 10 companies in your target niche.",
    "Final blocker: outreach_plan.md is empty and we lack the Ainex value prop.",
    "That completes this phase. Ready for your review.",
  ];
  for (const text of cases) {
    assert.equal(looksLikePostToolStall(text, true), false, text);
  }
});

test("looksLikePostToolStall still nudges when completion is followed by a next-step promise", () => {
  assert.equal(
    looksLikePostToolStall(
      "I've read the plan and it's empty. I'll search internal docs for the Ainex value prop next.",
      true
    ),
    true
  );
});

test("matchesFutureActionIntent covers transcript progressive/imperative phrases", () => {
  const cases = [
    "Executing now.",
    "I'm updating the configuration now.",
    "I'm implementing the CC requirement now.",
    "Registering web_agent_hunt_loop... (120 min interval, search → verify → personalize → send → log).",
    "I'm registering the web_agent_hunt_loop cron job now.",
    "Step 1: Patching the outreach-hunter skill.",
    "Step 2: Refreshing the web_agent_hunt_loop cron.",
  ];
  for (const text of cases) {
    assert.equal(matchesFutureActionIntent(text), true, text);
  }
});

test("looksLikePreToolPromiseStall nudges transcript cron registration promises", () => {
  assert.equal(
    looksLikePreToolPromiseStall(
      "I'm registering the web_agent_hunt_loop cron job now.\n\nJob Registered: web_agent_hunt_loop",
      NO_TOOLS,
      false
    ),
    true
  );
});

test("looksLikePostToolStall nudges executing-now after prior tools", () => {
  assert.equal(
    looksLikePostToolStall(
      "I'm updating the outreach-hunter skill and refreshing the cron job.\n\nExecuting now.",
      true
    ),
    true
  );
});

test("cron verification helpers track register/list ids", () => {
  assert.equal(
    cronRegisterJobIdFromArgs({ id: "web_agent_hunt_loop", everyMinutes: 120 }),
    "web_agent_hunt_loop"
  );
  assert.equal(cronRegisterJobIdFromArgs({ action: "remove", id: "x" }), "");
  const listed = cronJobIdsFromListResult({
    success: true,
    count: 1,
    jobs: [{ id: "web_agent_hunt_loop", everyMinutes: 120 }],
  });
  assert.ok(listed.has("web_agent_hunt_loop"));
});

test("shouldContinueCronVerification requires cron_list after register", () => {
  const pending = new Set(["web_agent_hunt_loop"]);
  assert.equal(shouldContinueCronVerification(pending, 0), true);
  pending.delete("web_agent_hunt_loop");
  assert.equal(shouldContinueCronVerification(pending, 0), false);
});

test("buildContinuationNudge cron_verify mentions pending ids", () => {
  const nudge = buildContinuationNudge("cron_verify", {
    pendingCronIds: ["web_agent_hunt_loop"],
  });
  assert.match(nudge, /cron_list/i);
  assert.match(nudge, /web_agent_hunt_loop/);
});

test("userRequestedStructuredTodos detects checklist-style probes", () => {
  assert.equal(
    userRequestedStructuredTodos("Use todo_write with 12 items; minimum 10 tool rounds."),
    true
  );
  assert.equal(userRequestedStructuredTodos("What is 2+2?"), false);
});

test("shouldContinueIncompleteTodos nudges when todos remain open", () => {
  const msg = "Execute each item in its own round via todo_write.";
  assert.equal(
    shouldContinueIncompleteTodos(msg, true, 0, { total: 12, completed: 2, open: 10 }),
    true
  );
  assert.equal(
    shouldContinueIncompleteTodos(msg, true, 0, { total: 12, completed: 12, open: 0 }),
    false
  );
  const exactMsg = "Execute each checklist item. End with exactly: Probe done.";
  assert.equal(
    shouldContinueIncompleteTodos(exactMsg, true, 0, { total: 12, completed: 2, open: 10 }, "Probe done."),
    false
  );
});

test("shouldContinueIncompleteTodos continues despite faux completion when todos remain open", () => {
  const msg = "Refactor auth, update docs, migrate DB, and notify customers.";
  const stats = { total: 4, completed: 1, open: 3 };
  const opts = { todosSeededAtTurnStart: true };
  assert.equal(
    shouldContinueIncompleteTodos(msg, true, 0, stats, "Auth refactor done. Task complete.", opts),
    true
  );
  assert.equal(
    shouldContinueIncompleteTodos(msg, true, 0, stats, "All set — ready for your review.", opts),
    true
  );
});

test("shouldContinueIncompleteTodos continues for open todos without structured-todo phrasing", () => {
  const msg = "Refactor auth, update docs, migrate DB, and notify customers.";
  assert.equal(
    shouldContinueIncompleteTodos(msg, true, 0, { total: 4, completed: 1, open: 3 }, "", {
      todosSeededAtTurnStart: true,
    }),
    true
  );
});

test("shouldContinueIncompleteTodos stops when assistant asks user for input", () => {
  assert.equal(
    shouldContinueIncompleteTodos(
      "Use todo_write with 12 items.",
      true,
      0,
      { total: 12, completed: 2, open: 10 },
      "Which collection slug should I use for the blog post?"
    ),
    false
  );
});

test("buildContinuationNudge incomplete_todos mentions open count", () => {
  const nudge = buildContinuationNudge("incomplete_todos", { openTodos: 8, totalTodos: 12 });
  assert.match(nudge, /8 of 12/i);
  assert.match(nudge, /todo/i);
});

test("matchesUserInputRequest ignores give me a second stall filler", () => {
  assert.equal(matchesUserInputRequest("Give me a second to track down the remaining targets."), false);
  assert.equal(matchesUserInputRequest("Give me a moment while I search."), false);
  assert.equal(matchesUserInputRequest("Give me the list of domains and I'll start pulling contacts."), true);
});

test("looksLikePreToolPromiseStall nudges transcript skill-install promise with give me a second", () => {
  const text =
    "Let's do it. I'll dig back into the search and get those installed. Give me a second to track down the remaining targets.";
  assert.equal(looksLikePreToolPromiseStall(text, NO_TOOLS, false), true);
  assert.equal(shouldContinuePreToolPromiseStall(text, NO_TOOLS, false, 0), true);
});

test("looksLikePreToolPromiseStall nudges even when prior turns had tool results", () => {
  const conv = [{ role: "user", content: "Tool results (compact JSON):\n[]" }];
  const text = "I'll dig back into the search and install the remaining VoltAgent skills.";
  assert.equal(hasToolContextInConversation(conv, false), true);
  assert.equal(looksLikePreToolPromiseStall(text, conv, false), true);
});

test("looksLikeEmptyResponse and shouldContinueEmptyResponse detect blank assistant turns", () => {
  assert.equal(looksLikeEmptyResponse(""), true);
  assert.equal(looksLikeEmptyResponse("   "), true);
  assert.equal(looksLikeEmptyResponse("Done."), false);
  assert.equal(shouldContinueEmptyResponse("", 0), true);
  assert.equal(shouldContinueEmptyResponse("", MAX_EMPTY_RESPONSE_CONTINUATIONS), false);
});

test("looksLikeTruncatedResponse and shouldContinueTruncation detect length finish", () => {
  assert.equal(looksLikeTruncatedResponse("length"), true);
  assert.equal(looksLikeTruncatedResponse("stop"), false);
  assert.equal(shouldContinueTruncation("length", 0), true);
  assert.equal(shouldContinueTruncation("length", MAX_TRUNCATION_CONTINUATIONS), false);
  assert.match(buildContinuationNudge("truncation"), /continue exactly where you left off/i);
});

test("resolveTurnStopReason labels normal chat and deliverables as completed", () => {
  assert.equal(resolveTurnStopReason("Hey hey! What's up?", false), "completed");
  assert.equal(
    resolveTurnStopReason(
      "Pretty clean slate. Want to start something — build a project, explore a skill, or just chat?",
      true
    ),
    "completed"
  );
  assert.equal(
    resolveTurnStopReason("Let me fetch the best skill pages before I deliver the final table.", true),
    "post_tool_no_continue"
  );
  assert.equal(resolveTurnStopReason("", false), "no_tools_no_continue");
});

test("shouldDeferTruncatedContentToolExecution blocks write_file on length finish", () => {
  const truncatedFrontmatter = `---
title: "BitNet"
published_at: "2026-05-29T20`;
  const tools = [
    {
      name: "write_file",
      arguments: { path: "work/article.md", content: truncatedFrontmatter },
    },
  ];
  assert.equal(isDeferrableTruncatedContentTool(tools[0]!), true);
  assert.equal(shouldDeferTruncatedContentToolExecution("length", tools, 0), true);
  assert.equal(shouldDeferTruncatedContentToolExecution("stop", tools, 0), false);
  assert.equal(
    shouldDeferTruncatedContentToolExecution("length", tools, MAX_TRUNCATION_CONTINUATIONS),
    false
  );
  assert.match(
    buildContinuationNudge("truncation", { truncatedWriteFile: true }),
    /append.*true/i
  );
});

test("partitionToolsForTruncatedContentDeferral runs reads while deferring truncated writes", () => {
  const tools = [
    { name: "read_file", arguments: { path: "work/article.md" } },
    { name: "write_file", arguments: { path: "work/article.md", content: "---\ntitle: x" } },
  ];
  const { defer, run } = partitionToolsForTruncatedContentDeferral("length", tools, 0);
  assert.equal(defer.length, 1);
  assert.equal(defer[0]?.name, "write_file");
  assert.equal(run.length, 1);
  assert.equal(run[0]?.name, "read_file");
  assert.deepEqual(partitionToolsForTruncatedContentDeferral("stop", tools, 0), {
    defer: [],
    run: tools,
  });
});

test("looksLikePostToolStall detects Executing now after long blueprint text", () => {
  const blueprint =
    "Article Blueprint:\n".repeat(80) +
    "• Title: When Prompts Become Shells\n• Angle: Agent hijacking\n• Key Point: Execution boundary\n\nExecuting now.";
  assert.equal(looksLikePostToolStall(blueprint, true), true);
});

test("buildContinuationNudge post_tool_stall adds repeated stall hint from 2nd nudge", () => {
  const first = buildContinuationNudge("post_tool_stall", { continuationCount: 1 });
  const second = buildContinuationNudge("post_tool_stall", { continuationCount: 2 });
  assert.doesNotMatch(first, /Do not send another status message/i);
  assert.match(second, /Do not send another status message/i);
});

test("shouldContinuePostToolStall allows up to MAX cap", () => {
  const text = "I'm creating the English translation record now.\n\nExecuting now.";
  assert.equal(
    shouldContinuePostToolStall(text, true, MAX_POST_TOOL_STALL_CONTINUATIONS - 1),
    true
  );
  assert.equal(
    shouldContinuePostToolStall(text, true, MAX_POST_TOOL_STALL_CONTINUATIONS),
    false
  );
});

test("looksLikePostToolStall nudges plan after offer when user already approved task", () => {
  const text =
    "Want me to try the native sequence?\n\nPlan:\n1. Parse the markdown.\n2. Create parent records.\n\nLet's start with parsing.";
  assert.equal(looksLikePostToolStall(text, true), true);
  assert.equal(shouldSuppressContinuationNudge(text), false);
});

test("looksLikeFindSkillsDeliveryStall after web tools without table", () => {
  const user = "The user invoked **find-skills mode** via `/find_skills`.";
  assert.equal(looksLikeFindSkillsDeliveryStall(user, "", true, 2), true);
  assert.equal(
    looksLikeFindSkillsDeliveryStall(user, "Still fetching registry pages…", true, 3),
    true
  );
  assert.equal(
    looksLikeFindSkillsDeliveryStall(user, "I'll grab another live registry page.", true, 6),
    true
  );
  const table =
    "## Top 5 skills for python\n\n| # | Skill | Registry | Popularity | Summary | Install / link |\n|---|---|---|---|---|---|";
  assert.equal(looksLikeFindSkillsDeliveryStall(user, table, true, 6), false);
});

test("shouldContinueFindSkillsDelivery respects cap", () => {
  const user = "find-skills mode";
  assert.equal(shouldContinueFindSkillsDelivery(user, "", true, 2, 0), true);
  assert.equal(shouldContinueFindSkillsDelivery(user, "", true, 2, 3), false);
});

test("userRequestedArticlePublish detects research write and publish blog ask", () => {
  const user =
    "Search adn create a ewew article for me about Microsoft's bitNet and publish it on our blog";
  assert.equal(userRequestedArticlePublish(user), true);
  assert.equal(userRequestedArticlePublish("write an article about rust"), false);
  assert.equal(userRequestedArticlePublish("publish the readme on our blog"), false);
});

test("shouldContinueIncompletePublishDeliverable nudges after draft without publish", () => {
  const user =
    "Search and create an article about BitNet and publish it on our blog";
  const toolCalls = [
    { name: "web_search" },
    { name: "web_fetch" },
    { name: "write_file" },
    { name: "read_file" },
  ];
  const visible = "Let me check what's on disk and build this article properly.";
  assert.equal(
    shouldContinueIncompletePublishDeliverable(user, toolCalls, true, visible, 0),
    true
  );
  assert.equal(
    shouldContinueIncompletePublishDeliverable(
      user,
      [...toolCalls, { name: "web_post" }],
      true,
      visible,
      0
    ),
    false
  );
  assert.equal(
    shouldContinueIncompletePublishDeliverable(
      user,
      toolCalls,
      true,
      visible,
      MAX_INCOMPLETE_PUBLISH_CONTINUATIONS
    ),
    false
  );
});

test("shouldContinueIncompletePublishDeliverable continues despite draft-ready completion phrasing", () => {
  const user =
    "Search and create an article about BitNet and publish it on our blog";
  const toolCalls = [{ name: "web_search" }, { name: "write_file" }];
  assert.equal(
    shouldContinueIncompletePublishDeliverable(
      user,
      toolCalls,
      true,
      "The draft is ready for your review. All set.",
      0
    ),
    true
  );
  assert.equal(
    shouldContinueIncompletePublishDeliverable(
      user,
      toolCalls,
      true,
      "Which Directus collection slug should I publish to?",
      0
    ),
    false
  );
});

test("looksLikePostToolStall detects let me write article promises", () => {
  assert.equal(
    looksLikePostToolStall("Let me write the full article with the body content included.", true),
    true
  );
});

test("looksLikePostToolStall detects let me grab article promises", () => {
  assert.equal(
    looksLikePostToolStall(
      "Let me grab the full article content so we can see what's there and what's missing.",
      true
    ),
    true
  );
});

test("userRequestedContentShare detects share for review ask", () => {
  assert.equal(userRequestedContentShare("share the article to see for review"), true);
  assert.equal(userRequestedContentShare("Show me this Bitnet article for approval"), true);
  assert.equal(userRequestedContentShare("can you show me the article in markdown?"), true);
  assert.equal(userRequestedContentShare("continue working on article"), false);
});

test("shouldContinueContentShareDeliverable nudges after read_file without pasted draft", () => {
  const user = "share the article to see for review";
  const toolCalls = [{ name: "read_file" }];
  const visible = "Let me grab the full article content so we can see what's there and what's missing.";
  assert.equal(shouldContinueContentShareDeliverable(user, toolCalls, true, visible, 0), true);
  assert.equal(
    shouldContinueContentShareDeliverable(
      user,
      toolCalls,
      true,
      `# BitNet B1.58\n\n${"Body paragraph. ".repeat(80)}`,
      0
    ),
    false
  );
  assert.equal(
    shouldContinueContentShareDeliverable(user, toolCalls, true, visible, MAX_CONTENT_SHARE_CONTINUATIONS),
    false
  );
});

test("contentShareDeliverableSatisfied detects pasted markdown draft", () => {
  const draft = `# Title\n\n${"Section text. ".repeat(60)}`;
  assert.equal(contentShareDeliverableSatisfied(draft), true);
  assert.equal(contentShareDeliverableSatisfied("Here is a short summary."), false);
});

test("contentShareDeliverableSatisfied rejects long promise-only ramble", () => {
  const ramble =
    ("Hey! Good to see you again. You asked me to share it for review, so let me grab the article. ".repeat(30)) +
    "Let me present it properly.";
  assert.ok(ramble.length >= 1500);
  assert.equal(contentShareDeliverableSatisfied(ramble), false);
});

test("contentShareDeliverableSatisfied accepts visible containing read_file body", () => {
  const articleBody = `# BitNet B1.58\n\n${"Quantized inference enables edge deployment. ".repeat(20)}`;
  const executions = [
    {
      tool: "read_file",
      result: { ok: true, path: "work/bitnet-article/bitnet-b1-58-2b4t.md", content: articleBody },
    },
  ];
  assert.equal(contentShareDeliverableSatisfied("Here is the draft:\n\n" + articleBody, executions), true);
  assert.equal(visibleContainsReadFileContent(articleBody.slice(0, 120), articleBody), true);
});

test("contentShareDeliverableSatisfied rejects title-only echo after read_file", () => {
  const articleBody = `# BitNet B1.58\n\n${"Quantized inference enables edge deployment. ".repeat(20)}`;
  const executions = [
    {
      tool: "read_file",
      result: { ok: true, path: "work/bitnet-article/bitnet-b1-58-2b4t.md", content: articleBody },
    },
  ];
  const preamble =
    "Let me grab the full content properly — the read_file only showed\n\n# BitNet B1.58";
  assert.equal(contentShareDeliverableSatisfied(preamble, executions), false);
});

test("shouldContinueContentShareDeliverable nudges past faux completion without pasted body", () => {
  const user = "can you show me the article in markdown?";
  const toolCalls = [{ name: "read_file" }];
  const visible = "Here is the article for your review.";
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "work/bitnet-article/bitnet-b1-58-2b4t.md",
        content: `# BitNet B1.58\n\n${"Body. ".repeat(120)}`,
      },
    },
  ];
  assert.equal(
    shouldContinueContentShareDeliverable(user, toolCalls, true, visible, 0, executions),
    true
  );
});

test("shouldContinueContentShareDeliverable when read_file only in lastToolExecutions", () => {
  const user = "can you show me the article in markdown?";
  const visible = "Let me grab the full content properly — the read_file only showed";
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "work/bitnet-article/bitnet-b1-58-2b4t.md",
        content: `# BitNet B1.58\n\n${"Body. ".repeat(120)}`,
      },
    },
  ];
  assert.equal(shouldContinueContentShareDeliverable(user, [], true, visible, 0, executions), true);
});

test("looksLikePreToolPromiseStall detects promise before DSML tail is stripped", () => {
  const dsml = `<｜DSML｜tool_calls><｜DSML｜invoke name="browse_workspace"><｜DSML｜parameter name="action" string="true">find</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>`;
  const text = `Let me start by finding where everything lives.\n\n${dsml}`;
  assert.equal(looksLikePreToolPromiseStall(text, NO_TOOLS, false), true);
});

test("looksLikePreToolPromiseStall detects promise before plain tool hint tail", () => {
  const raw = `Let me look into what was being worked on.

tree
.

article draft content read_file`;
  assert.equal(looksLikePreToolPromiseStall(raw, NO_TOOLS, false), true);
});

test("shouldContinueUnparsedToolMarkup fires when DSML present and no tools parsed", () => {
  const dsml = `<｜DSML｜tool_calls><｜DSML｜invoke name="read_file"></｜DSML｜invoke></｜DSML｜tool_calls>`;
  assert.equal(shouldContinueUnparsedToolMarkup(dsml, 0, 0), true);
  assert.equal(shouldContinueUnparsedToolMarkup(dsml, 0, MAX_UNPARSED_TOOL_MARKUP_CONTINUATIONS), false);
  assert.equal(shouldContinueUnparsedToolMarkup(dsml, 1, 0), false);
});

test("buildContentShareContinuationNudge includes path on final attempt", () => {
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "work/bitnet-article/bitnet-b1-58-2b4t.md",
        content: `# Title\n\n${"Body. ".repeat(80)}`,
      },
    },
  ];
  const nudge = buildContentShareContinuationNudge(MAX_CONTENT_SHARE_CONTINUATIONS, executions);
  assert.match(nudge, /work\/bitnet-article\/bitnet-b1-58-2b4t\.md/);
  assert.match(nudge, /Do not call read_file again/i);
});

test("userRequestedContentShare matches Share the file with me", () => {
  assert.equal(userRequestedContentShare("Share the file with me"), true);
});

test("shouldContinueIncompleteTodos ignores stale todos on simple share request", () => {
  const stats = { total: 4, completed: 1, open: 3 };
  assert.equal(
    shouldContinueIncompleteTodos("Share the file with me", true, 0, stats),
    false
  );
  assert.equal(
    shouldContinueIncompleteTodos("Share the file with me", true, 0, stats, "", {
      todosSeededAtTurnStart: true,
    }),
    false
  );
});

test("shouldContinueIncompleteTodos still nudges when todos seeded at turn start", () => {
  assert.equal(
    shouldContinueIncompleteTodos(
      "Write me a fresh article about CISO challenges in 2026",
      true,
      0,
      { total: 4, completed: 1, open: 3 },
      "",
      { todosSeededAtTurnStart: true }
    ),
    true
  );
});

test("buildContentShareFallbackVisible pastes read_file body", () => {
  const article = `# CISO Challenges\n\n${"Paragraph. ".repeat(40)}`;
  const visible = buildContentShareFallbackVisible([
    {
      tool: "read_file",
      result: { ok: true, path: "projects/ciso/article.md", content: article },
    },
  ]);
  assert.ok(visible);
  assert.match(visible!, /projects\/ciso\/article\.md/);
  assert.match(visible!, /CISO Challenges/);
});

test("shouldApplyContentShareFallback after continuation cap with unread pasted body", () => {
  const user = "Share the file with me";
  const visible = "Let me read the current state and share it properly.";
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "projects/ciso/article.md",
        content: `# CISO Challenges\n\n${"Paragraph. ".repeat(40)}`,
      },
    },
  ];
  assert.equal(
    shouldApplyContentShareFallback(user, true, MAX_CONTENT_SHARE_CONTINUATIONS, visible, executions),
    true
  );
  assert.equal(
    shouldApplyContentShareFallback(user, true, MAX_CONTENT_SHARE_CONTINUATIONS - 1, visible, executions),
    false
  );
});
