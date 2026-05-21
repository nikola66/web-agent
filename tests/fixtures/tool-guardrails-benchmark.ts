import {
  TOOL_LOOP_GUARDRAIL_DEFAULTS,
  type ToolGuardrailAction,
  type ToolLoopGuardrailConfig,
} from "../../src/agent/runtime/tools/tool-loop-guardrails.ts";

export type BenchmarkCategory =
  | "exact_failure_warn"
  | "exact_failure_block"
  | "same_tool_warn"
  | "same_tool_halt"
  | "idempotent_no_progress_warn"
  | "idempotent_no_progress_block"
  | "success_reset"
  | "file_mutation_ok"
  | "clean_success_chain"
  | "mixed_workflow";

export type ExpectedDecision = {
  action: ToolGuardrailAction;
  code?: string;
};

export type BenchmarkStep = {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  failed?: boolean;
  expectBefore?: ExpectedDecision;
  expectAfter?: ExpectedDecision;
};

export type BenchmarkCase = {
  id: string;
  prompt: string;
  category: BenchmarkCategory;
  config?: Partial<ToolLoopGuardrailConfig>;
  steps: BenchmarkStep[];
  expectHalt?: boolean;
};

export const BENCHMARK_TARGET_COUNT = 1000;

/** Curated realistic user prompts — cycled and combined with template variants below. */
const REALISTIC_PROMPTS = [
  "Read README.md and summarize the architecture in three bullets.",
  "Open package.json and tell me the current version and main scripts.",
  "Show the first 40 lines of src/agent/runtime/turn.ts and explain the main loop.",
  "Run npm test and fix any failing unit tests before stopping.",
  "Execute ls -la in the workspace root and list top-level directories.",
  "Diagnose why run_shell keeps returning exit code 1 for npm test.",
  "Find YouTubers in UAE posting about openclaw; search then fetch top URLs.",
  "Research Hermes Agent tool guardrails and summarize how warn-first works.",
  "Discover competitors to web-agent; run several web_search queries before concluding.",
  "Install the open-web-research skill from a remote SKILL.md URL via skill_bulk_save.",
  "Call skill_view with project-scaffold before creating a new demo app tree.",
  "Save a procedural skill after completing this migration with skill_save.",
  "Refactor loop guard out: delete model assets, port Hermes guardrails, update docs, run tests.",
  "Create projects/demo-app/, add index.html with write_file, then run npm test.",
  "Run wiki_setup, wiki_sync, wiki_search, then present a summary artifact.",
  "Patch src/agent/adapter.ts to remove stale IPC handlers and verify with read_file.",
  "Write a new benchmark test file; lint errors on write should not count as failure.",
  "Apply_patch on turn.ts then verify the diff with read_file.",
  "Recall the user timezone from memory_recall and use it in the reply.",
  "Search memory for prior tool-guard decisions with memory_search.",
  "Save a memory fact that the user prefers npm test over vitest.",
  "List files under src/agent/runtime/tools/builtins and grep for run_shell usage.",
  "Find all TODO comments under docs/ and compile them into a markdown table.",
  "Fetch https://example.com/docs and extract installation steps with web_fetch.",
  "Transcribe the YouTube URL the user pasted using youtube_transcribe.",
  "Compare file_stat on two paths and explain which file is newer.",
  "Generate a file diff between plans/a.md and plans/b.md.",
  "Register a daily digest cron job that emails research summaries.",
  "Send a short status email via the email tool after tests pass.",
  "Present the final report with artifact_present instead of dumping the full body.",
  "Use todo_write with one in_progress item before a multi-step refactor.",
  "Bulk-save three skills from GitHub raw SKILL.md URLs in one confirmation batch.",
  "Delete an obsolete skill with skill_delete after user confirmation.",
  "Move generated outputs from tmp/ into projects/export/ with move_file.",
  "Create work/scratch-{date}/ before ad-hoc spike files.",
  "Run web_search for niche keywords, then web_fetch at least two result URLs.",
  "Stop repeating identical read_file calls — use the result already returned.",
  "If terminal fails, run pwd && ls -la before retrying npm commands.",
  "Inspect .env.example and mirror new guardrail env vars into docs.",
  "Update Spanish and Arabic architecture docs after changing turn behavior.",
  "Fix flaky tests in tests/tool-loop-guardrails.test.ts and re-run npm test.",
  "Add a 1000-case benchmark for tool guardrails similar to the old loop-guard suite.",
  "Verify transformers-env still serves whisper paths after removing loop-guard constants.",
  "Smoke the chat panel after adapter changes in npm run dev.",
  "Explain why the agent stopped after five identical web_fetch failures.",
  "Continue the approved plan in plans/2026-05-18-auth-refactor.md without re-asking.",
  "Execute step 3 from the todo list: wire guardrails into turn.ts before tools run.",
  "User changed topic — ignore the old file path and work on src/ui/ChatInput.tsx instead.",
  "Copy the exact token FOO_BAR_TOKEN byte-for-byte into the test fixture.",
  "Research whether any creators in KSA discuss hermes agent; fan out searches first.",
  "After search-only rounds, fetch YouTube channel pages before synthesizing.",
  "Do not switch to text-only replies when shell keeps failing — keep using tools.",
  "Try read_file on the spilled snapshot path only when result_ref is present.",
  "Unwrap snapshot read_file executions before compressing tool results.",
  "Promote a learning from this run if we recovered from repeated grep failures.",
  "Self-improve: if this checklist is reusable, save it as a compact SKILL.md.",
  "Hard-stop is off by default — warn on repeated failures but keep executing.",
  "Enable hard_stop in .env.local and confirm repeated exact failures get blocked.",
  "Block idempotent read_file loops that return the same JSON payload repeatedly.",
  "Halting same-tool run_shell streak should end the turn with a clear message.",
  "Reset failure counters after one successful web_search with the same query.",
  "write_file succeeded with lint noise — do not treat lint as tool failure.",
  "apply_patch landed but LSP diagnostics show type errors — still success.",
  "grep for loop-guard references and remove stale imports across the repo.",
  "tree the projects/ directory and summarize depth and file counts.",
  "find_files matching **/*.test.ts under tests/ and list newest five.",
  "session_search prior turns for 'guardrails pivot' before answering.",
  "session_memory_list facts saved this session and append one more note.",
  "system_info to check runtime before recommending run_shell vs dedicated tools.",
  "vision_analyze the screenshot the user attached in uploads/.",
  "audio_analyze the voice note and continue the task from transcription.",
  "skill_list available skills and recommend one for open-web research.",
  "skill_recall triggers related to wiki or vault setup.",
  "wiki_search PARA folders for prior notes on tool loop detection.",
  "cron_list scheduled jobs and disable obsolete entries if any.",
  "edit_file a single function in turn.ts without rewriting the whole file.",
  "multi_edit three small typos across docs/agent-notes.md in one batch.",
  "delete_file the obsolete loop-guard-worker stub if it still exists anywhere.",
  "make_dir projects/benchmark-spike/ before generating large fixture files.",
  "run_shell node -e 'console.log(1)' in Nodebox — no POSIX shell features.",
  "web_fetch a GitHub raw URL for a skill SKILL.md then skill_save content.",
  "Stop retrying the same failing web_fetch URL — change strategy or report blocker.",
  "Use absolute paths when read_file fails on relative paths from wrong cwd.",
  "Narrow grep pattern instead of repeating identical search across repo root.",
  "Fetch smaller pages when web_fetch truncates at the inline char cap.",
  "Parallelize safe reads but serialize mutating writes in this refactor.",
  "Answer with a markdown table, not Unicode box-drawing, in the final reply.",
  "Include at least one mermaid diagram in the plan deliverable.",
  "Do not dump artifact body again after artifact_present — one-line summary only.",
  "User invoked /plan — research, write plans/*.md, artifact_present, then stop.",
  "Explicit plan execution: read plans/latest.md first, then implement step 1.",
  "Gate: call todo_write before a multi-step migration with more than six steps.",
  "Research intent detected — raise search/fetch minimums before concluding.",
  "Telegram turn: keep working message cadence while long research runs.",
  "Invalid tool args were rejected — fix schema and retry with required fields.",
  "Skip duplicate successful tool calls in the same turn when already executed.",
  "Guardrail appended warning to tool result — model should change approach next round.",
  "Synthetic block result returned — tool did not execute due to hard stop.",
  "Mixed batch: one tool blocked, others still run and return compact JSON results.",
  "After halt decision, turn should stop with tool_guardrail reason in transcript.",
];

const PROMPT_TEMPLATES = [
  (i: number) => `Fix failing tests in ${["tests/turn.test.ts", "tests/adapter.test.ts", "tests/tool-loop-guardrails.test.ts"][i % 3]} and summarize root cause.`,
  (i: number) => `Refactor ${["adapter.ts", "turn.ts", "tool-loop-guardrails.ts"][i % 3]} to remove dead code from the loop-guard pivot.`,
  (i: number) => `Research ${["openclaw", "hermes agent", "cursor agents", "web-agent"][i % 4]} creators in ${["UAE", "KSA", "Qatar", "Bahrain"][i % 4]} with multiple searches.`,
  (i: number) => `Create projects/${["demo", "spike", "audit", "bench"][i % 4]}-${i}/ and scaffold ${["index.html", "README.md", "package.json"][i % 3]}.`,
  (i: number) => `Read ${["docs/ARCHITECTURE.md", "docs/agent-notes.md", "README.md"][i % 3]} and update the tool guardrails section.`,
  (i: number) => `Run grep for '${["loop-guard", "LoopGuard", "tool-failure-streak", "prefetchClassifier"][i % 4]}' under src/ and clean stale hits.`,
  (i: number) => `Install skill from https://example.com/skills/${i}/SKILL.md using skill_manage import_url.`,
  (i: number) => `Execute plan step ${(i % 5) + 1}: ${["list_dir", "read_file", "apply_patch", "run_shell test", "artifact_present"][i % 5]}.`,
  (i: number) => `Memory task: ${["save", "recall", "search", "append"][i % 4]} user preference about ${["timezone", "test runner", "model", "language"][i % 4]}.`,
  (i: number) => `Wiki ${["setup", "sync", "search"][i % 3]} for knowledge about tool loop guardrails case ${i}.`,
  (i: number) => `Debug repeated ${["web_fetch", "run_shell", "read_file", "grep"][i % 4]} failures in turn ${i}; change args before retrying.`,
  (i: number) => `Write ${["unit", "integration", "benchmark"][i % 3]} tests for guardrail category ${["exact_failure", "same_tool", "no_progress"][i % 3]}.`,
  (i: number) => `Compare ${["read_file", "grep", "web_search"][i % 3]} outputs and stop re-querying once results stabilize.`,
  (i: number) => `Ship fix for issue #${1000 + i}: guardrails should ${["warn", "block", "halt", "reset"][i % 4]} on repeated tool loops.`,
  (i: number) => `User asked for exact string '${["FOO_BAR", "API_KEY_X", "TOKEN_123", "PATH_ABS"][i % 4]}' — copy byte-for-byte into output.`,
];

function realisticPrompt(index: number): string {
  if (index < REALISTIC_PROMPTS.length) return REALISTIC_PROMPTS[index]!;
  const t = PROMPT_TEMPLATES[(index - REALISTIC_PROMPTS.length) % PROMPT_TEMPLATES.length]!;
  return t(index);
}

function cfgHardStop(overrides: Partial<ToolLoopGuardrailConfig> = {}): Partial<ToolLoopGuardrailConfig> {
  return { ...TOOL_LOOP_GUARDRAIL_DEFAULTS, hardStopEnabled: true, ...overrides };
}

function expectExactAfter(count: number, config: ToolLoopGuardrailConfig): ExpectedDecision {
  if (config.warningsEnabled && count >= config.exactFailureWarnAfter) {
    return { action: "warn", code: "repeated_exact_failure_warning" };
  }
  return { action: "allow", code: "allow" };
}

function expectSameToolAfter(count: number, config: ToolLoopGuardrailConfig): ExpectedDecision {
  if (config.hardStopEnabled && count >= config.sameToolFailureHaltAfter) {
    return { action: "halt", code: "same_tool_failure_halt" };
  }
  if (config.warningsEnabled && count >= config.sameToolFailureWarnAfter) {
    return { action: "warn", code: "same_tool_failure_warning" };
  }
  return { action: "allow", code: "allow" };
}

function expectNoProgressAfter(repeatCount: number, config: ToolLoopGuardrailConfig): ExpectedDecision {
  if (config.warningsEnabled && repeatCount >= config.noProgressWarnAfter) {
    return { action: "warn", code: "idempotent_no_progress_warning" };
  }
  return { action: "allow", code: "allow" };
}

function expectExactBefore(priorFailures: number, config: ToolLoopGuardrailConfig): ExpectedDecision {
  if (config.hardStopEnabled && priorFailures >= config.exactFailureBlockAfter) {
    return { action: "block", code: "repeated_exact_failure_block" };
  }
  return { action: "allow", code: "allow" };
}

function expectNoProgressBefore(priorRepeats: number, config: ToolLoopGuardrailConfig): ExpectedDecision {
  if (config.hardStopEnabled && priorRepeats >= config.noProgressBlockAfter) {
    return { action: "block", code: "idempotent_no_progress_block" };
  }
  return { action: "allow", code: "allow" };
}

function mergeConfig(partial?: Partial<ToolLoopGuardrailConfig>): ToolLoopGuardrailConfig {
  return { ...TOOL_LOOP_GUARDRAIL_DEFAULTS, ...partial };
}

const CATEGORY_COUNTS: Record<BenchmarkCategory, number> = {
  exact_failure_warn: 150,
  exact_failure_block: 80,
  same_tool_warn: 150,
  same_tool_halt: 80,
  idempotent_no_progress_warn: 150,
  idempotent_no_progress_block: 80,
  success_reset: 100,
  file_mutation_ok: 60,
  clean_success_chain: 100,
  mixed_workflow: 50,
};

export function buildToolGuardrailsBenchmarkCases(): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  let n = 0;
  let promptIdx = 0;

  const push = (c: Omit<BenchmarkCase, "id" | "prompt"> & { prompt?: string }) => {
    cases.push({
      ...c,
      prompt: c.prompt ?? realisticPrompt(promptIdx++),
      id: `tg-${String(++n).padStart(4, "0")}`,
    });
  };

  for (let i = 0; i < CATEGORY_COUNTS.exact_failure_warn; i++) {
    const reps = 2 + (i % 7);
    const config = mergeConfig();
    const tool = ["web_search", "run_shell", "web_fetch", "grep", "memory_search"][i % 5]!;
    const args =
      tool === "run_shell"
        ? { command: `npm test --case ${i}` }
        : tool === "web_search"
          ? { query: `exact-fail-${i}` }
          : tool === "web_fetch"
            ? { url: `https://example.com/${i}` }
            : tool === "grep"
              ? { pattern: "TODO", path: "src" }
              : { query: `memory-${i}` };
    const result =
      tool === "run_shell"
        ? JSON.stringify({ exit_code: 1, stderr: "fail" })
        : '{"error":"upstream failure"}';
    const steps: BenchmarkStep[] = [];
    for (let r = 1; r <= reps; r++) {
      steps.push({
        tool,
        args,
        result,
        failed: true,
        expectBefore: expectExactBefore(r - 1, config),
        expectAfter: expectExactAfter(r, config),
      });
    }
    push({ category: "exact_failure_warn", steps, expectHalt: false });
  }

  for (let i = 0; i < CATEGORY_COUNTS.exact_failure_block; i++) {
    const config = mergeConfig(cfgHardStop({ exactFailureBlockAfter: 2 + (i % 4) }));
    const blockAt = config.exactFailureBlockAfter;
    const reps = blockAt + 1;
    const tool = ["web_fetch", "web_search", "youtube_transcribe"][i % 3]!;
    const args =
      tool === "web_fetch"
        ? { url: `https://cdn.example/${i}` }
        : tool === "web_search"
          ? { query: `block-case-${i}` }
          : { url: `https://youtube.com/watch?v=${i}` };
    const steps: BenchmarkStep[] = [];
    for (let r = 1; r <= reps; r++) {
      steps.push({
        tool,
        args,
        result: '{"error":"timeout"}',
        failed: true,
        expectBefore: expectExactBefore(r - 1, config),
        expectAfter: r < reps ? expectExactAfter(r, config) : { action: "allow", code: "allow" },
      });
    }
    steps[reps - 1]!.expectBefore = expectExactBefore(blockAt, config);
    push({ category: "exact_failure_block", config, steps, expectHalt: true });
  }

  for (let i = 0; i < CATEGORY_COUNTS.same_tool_warn; i++) {
    const warnAfter = 2 + (i % 3);
    const config = mergeConfig({ sameToolFailureWarnAfter: warnAfter });
    const reps = warnAfter + 1;
    const tool = ["run_shell", "write_file", "apply_patch"][i % 3]!;
    const steps: BenchmarkStep[] = [];
    for (let r = 1; r <= reps; r++) {
      const result =
        tool === "run_shell"
          ? JSON.stringify({ exit_code: 1 })
          : JSON.stringify({ error: "failed", detail: `attempt-${r}` });
      steps.push({
        tool,
        args: { attempt: r, case: i, path: `src/x-${i}-${r}.ts` },
        result,
        failed: true,
        expectBefore: { action: "allow", code: "allow" },
        expectAfter: expectSameToolAfter(r, config),
      });
    }
    push({
      category: "same_tool_warn",
      config: { sameToolFailureWarnAfter: warnAfter },
      steps,
    });
  }

  for (let i = 0; i < CATEGORY_COUNTS.same_tool_halt; i++) {
    const haltAt = 3 + (i % 4);
    const config = mergeConfig(cfgHardStop({ sameToolFailureHaltAfter: haltAt, sameToolFailureWarnAfter: 2 }));
    const steps: BenchmarkStep[] = [];
    for (let r = 1; r <= haltAt; r++) {
      steps.push({
        tool: "run_shell",
        args: { command: `npm run test:case-${i}-${r}` },
        result: JSON.stringify({ exit_code: 1 }),
        failed: true,
        expectBefore: { action: "allow", code: "allow" },
        expectAfter: expectSameToolAfter(r, config),
      });
    }
    push({ category: "same_tool_halt", config, steps, expectHalt: true });
  }

  for (let i = 0; i < CATEGORY_COUNTS.idempotent_no_progress_warn; i++) {
    const config = mergeConfig();
    const tool = [
      "read_file",
      "grep",
      "web_search",
      "skill_view",
      "list_dir",
      "find_files",
      "wiki_search",
      "memory_recall",
    ][i % 8]!;
    const args =
      tool === "read_file"
        ? { path: `src/module-${i}.ts` }
        : tool === "grep"
          ? { pattern: "guardrail", path: "src" }
          : tool === "web_search"
            ? { query: `benchmark query ${i}` }
            : tool === "skill_view"
              ? { name: "open-web-research" }
              : tool === "list_dir"
                ? { path: `projects/run-${i}` }
                : tool === "find_files"
                  ? { pattern: `**/*-${i}.ts` }
                  : tool === "wiki_search"
                    ? { query: `note-${i}` }
                    : { key: `pref-${i}` };
    const result = JSON.stringify({ payload: `stable-result-${i}` });
    const reps = 2 + (i % 5);
    const steps: BenchmarkStep[] = [];
    for (let r = 1; r <= reps; r++) {
      steps.push({
        tool,
        args,
        result,
        failed: false,
        expectBefore: expectNoProgressBefore(r - 1, config),
        expectAfter: expectNoProgressAfter(r, config),
      });
    }
    push({ category: "idempotent_no_progress_warn", steps });
  }

  for (let i = 0; i < CATEGORY_COUNTS.idempotent_no_progress_block; i++) {
    const blockAt = 2 + (i % 3);
    const config = mergeConfig(cfgHardStop({ noProgressBlockAfter: blockAt, noProgressWarnAfter: 2 }));
    const tool = ["read_file", "web_fetch", "session_search"][i % 3]!;
    const args =
      tool === "read_file"
        ? { path: `docs/note-${i}.md` }
        : tool === "web_fetch"
          ? { url: `https://example.com/static-${i}.html` }
          : { query: `session-${i}` };
    const result = tool === "read_file" ? "identical markdown body" : JSON.stringify({ body: `same-${i}` });
    const steps: BenchmarkStep[] = [];
    for (let r = 1; r <= blockAt + 1; r++) {
      steps.push({
        tool,
        args,
        result,
        failed: false,
        expectBefore: expectNoProgressBefore(r - 1, config),
        expectAfter: r <= blockAt ? expectNoProgressAfter(r, config) : { action: "allow", code: "allow" },
      });
    }
    steps[blockAt]!.expectBefore = expectNoProgressBefore(blockAt, config);
    push({ category: "idempotent_no_progress_block", config, steps, expectHalt: true });
  }

  for (let i = 0; i < CATEGORY_COUNTS.success_reset; i++) {
    const config = mergeConfig(cfgHardStop({ exactFailureBlockAfter: 2 }));
    const tool = ["web_search", "apply_patch", "run_shell", "web_fetch"][i % 4]!;
    const args = { query: `reset-${i}`, path: `src/x-${i}.ts`, command: "npm test" };
    const okResult =
      tool === "run_shell"
        ? JSON.stringify({ exit_code: 0, stdout: "ok" })
        : tool === "web_search"
          ? '{"results":[]}'
          : tool === "apply_patch"
            ? JSON.stringify({ success: true, diff: "---\n+++" })
            : '{"html":"<p>ok</p>"}';
    const steps: BenchmarkStep[] = [
      {
        tool,
        args,
        result: '{"error":"first fail"}',
        failed: true,
        expectBefore: { action: "allow", code: "allow" },
        expectAfter: { action: "allow", code: "allow" },
      },
      {
        tool,
        args,
        result: okResult,
        failed: false,
        expectBefore: { action: "allow", code: "allow" },
        expectAfter: { action: "allow", code: "allow" },
      },
      {
        tool,
        args,
        result: '{"error":"second fail"}',
        failed: true,
        expectBefore: { action: "allow", code: "allow" },
        expectAfter: { action: "allow", code: "allow" },
      },
    ];
    push({ category: "success_reset", config, steps, expectHalt: false });
  }

  for (let i = 0; i < CATEGORY_COUNTS.file_mutation_ok; i++) {
    const tool = ["write_file", "apply_patch", "edit_file", "multi_edit"][i % 4]!;
    const steps: BenchmarkStep[] = [
      {
        tool,
        args: { path: `src/out-${i}.ts`, content: "export const x = 1;" },
        result: JSON.stringify({
          bytes_written: 24,
          success: true,
          lint: { status: "error", output: "SyntaxError: unexpected token" },
        }),
        expectAfter: { action: "allow", code: "allow" },
      },
      {
        tool,
        args: { path: `src/out-${i}.ts`, content: "export const x = 1;" },
        result: JSON.stringify({
          bytes_written: 24,
          success: true,
          lint: { status: "error", output: "SyntaxError: unexpected token" },
        }),
        expectAfter: { action: "allow", code: "allow" },
      },
    ];
    push({ category: "file_mutation_ok", steps });
  }

  const workflowTools = [
    ["skill_view", "web_search", "web_fetch", "write_file"],
    ["list_dir", "read_file", "grep", "apply_patch"],
    ["todo_write", "make_dir", "write_file", "run_shell"],
    ["wiki_setup", "wiki_sync", "wiki_search", "artifact_present"],
    ["memory_search", "memory_recall", "memory_save"],
    ["find_files", "read_file", "file_diff", "write_file"],
    ["skill_list", "skill_view", "skill_save"],
    ["web_search", "web_fetch", "youtube_transcribe", "write_file"],
    ["cron_list", "cron_register", "read_file"],
    ["system_info", "grep", "read_file", "apply_patch"],
  ] as const;

  for (let i = 0; i < CATEGORY_COUNTS.clean_success_chain; i++) {
    const chain = workflowTools[i % workflowTools.length]!;
    const steps: BenchmarkStep[] = chain.map((tool, j): BenchmarkStep => ({
      tool,
      args: { step: j, batch: i, path: `projects/run-${i}/file.txt`, query: `step-${j}` },
      result: JSON.stringify({ ok: true, tool, step: j }),
      failed: false,
      expectBefore: { action: "allow", code: "allow" },
      expectAfter: { action: "allow", code: "allow" },
    }));
    push({ category: "clean_success_chain", steps });
  }

  for (let i = 0; i < CATEGORY_COUNTS.mixed_workflow; i++) {
    const config = mergeConfig({ sameToolFailureWarnAfter: 2, noProgressWarnAfter: 2 });
    const steps: BenchmarkStep[] = [
      {
        tool: "read_file",
        args: { path: `src/a-${i}.ts` },
        result: JSON.stringify({ content: "ok" }),
        failed: false,
        expectAfter: { action: "allow", code: "allow" },
      },
      {
        tool: "grep",
        args: { pattern: "TODO", path: "src" },
        result: JSON.stringify({ matches: [] }),
        failed: false,
        expectAfter: { action: "allow", code: "allow" },
      },
      {
        tool: "run_shell",
        args: { command: `npm test --mixed-${i}` },
        result: JSON.stringify({ exit_code: 1 }),
        failed: true,
        expectAfter: { action: "allow", code: "allow" },
      },
      {
        tool: "run_shell",
        args: { command: `npm test --mixed-${i}-b` },
        result: JSON.stringify({ exit_code: 1 }),
        failed: true,
        expectAfter: expectSameToolAfter(2, config),
      },
      {
        tool: "read_file",
        args: { path: `src/a-${i}.ts` },
        result: JSON.stringify({ content: "ok" }),
        failed: false,
        expectAfter: expectNoProgressAfter(2, config),
      },
      {
        tool: "apply_patch",
        args: { path: `src/a-${i}.ts`, patch: "fix" },
        result: JSON.stringify({ success: true, diff: "---\n+++" }),
        failed: false,
        expectAfter: { action: "allow", code: "allow" },
      },
    ];
    push({
      category: "mixed_workflow",
      config: { sameToolFailureWarnAfter: 2, noProgressWarnAfter: 2 },
      steps,
      expectHalt: false,
    });
  }

  const total = Object.values(CATEGORY_COUNTS).reduce((a, b) => a + b, 0);
  if (cases.length !== total || total !== BENCHMARK_TARGET_COUNT) {
    throw new Error(`Expected ${BENCHMARK_TARGET_COUNT} benchmark cases, got ${cases.length}`);
  }
  return cases;
}

export const TOOL_GUARDRAILS_BENCHMARK_CASES = buildToolGuardrailsBenchmarkCases();

export const BENCHMARK_CATEGORIES = Object.keys(CATEGORY_COUNTS) as BenchmarkCategory[];

export function countCasesByCategory(cases: BenchmarkCase[]): Record<BenchmarkCategory, number> {
  const out = Object.fromEntries(BENCHMARK_CATEGORIES.map((c) => [c, 0])) as Record<
    BenchmarkCategory,
    number
  >;
  for (const c of cases) out[c.category] += 1;
  return out;
}
