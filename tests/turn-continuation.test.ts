import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeCodexIntermediateAck,
  looksLikeEmptyAfterTools,
  looksLikePostToolStall,
  looksLikePreToolPromiseStall,
  matchesFutureActionIntent,
  matchesUserInputRequest,
  matchesTaskCompletionOrFinalState,
  shouldSuppressContinuationNudge,
  hasToolContextInConversation,
  buildContinuationNudge,
  shouldContinueIntermediateAck,
  shouldContinueEmptyAfterTools,
  shouldContinuePostToolStall,
  shouldContinuePreToolPromiseStall,
  shouldContinueCronVerification,
  cronRegisterJobIdFromArgs,
  cronJobIdsFromListResult,
  MAX_INTERMEDIATE_ACK_CONTINUATIONS,
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
    shouldContinuePostToolStall("I'll search for the positioning first.", true, 1),
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
      1
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
