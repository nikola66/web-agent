import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  CHAT_READY_TIMEOUT_MS,
  clearBrowserStorage,
  configureOpenRouterApiKey,
  createProfile,
  launchDefaultAgent,
  runningChatInput,
  testingOpenRouterApiKey,
  waitForProfilesLoaded,
} from "./e2e-helpers";

const TESTING_OPENROUTER_API_KEY = testingOpenRouterApiKey();
const LOG_DIR = path.resolve(process.cwd(), "test-results/live-agent-quality");
const PROFILE_NAME = "LiveQ";

function redact(text: string): string {
  return String(text || "")
    .replace(/sk-or-v1-[a-z0-9]+/gi, "sk-or-v1-[redacted]")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

async function bodyText(page: Page) {
  return redact(await page.locator("body").innerText({ timeout: 10_000 }));
}

async function transcriptLength(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __WEBAGENT_LIVE_TRANSCRIPT__?: unknown[] };
    return Array.isArray(w.__WEBAGENT_LIVE_TRANSCRIPT__)
      ? w.__WEBAGENT_LIVE_TRANSCRIPT__.length
      : 0;
  });
}

async function transcriptSince(page: Page, index: number): Promise<string> {
  return redact(
    await page.evaluate((from) => {
      const w = window as typeof window & {
        __WEBAGENT_LIVE_TRANSCRIPT__?: Array<{ data?: string }>;
      };
      return (w.__WEBAGENT_LIVE_TRANSCRIPT__ || [])
        .slice(from)
        .map((entry) => String(entry?.data || ""))
        .join("");
    }, index)
  );
}

function latestAssistantBlock(transcript: string, agentName = PROFILE_NAME): string {
  const normalized = transcript.replace(/\r\n/g, "\n");
  const marker = `${agentName}\n ⎿`;
  const idx = normalized.lastIndexOf(marker);
  if (idx < 0) return normalized;
  const after = normalized.slice(idx + marker.length);
  const nextBoundaryMatches = [
    after.search(/\n[A-Za-z][^\n]{0,80}\n ⎿/),
    after.search(/\n▸\s/),
    after.search(/\n🫀/),
  ].filter((index) => index >= 0);
  const nextBoundary = nextBoundaryMatches.length ? Math.min(...nextBoundaryMatches) : -1;
  return (nextBoundary >= 0 ? after.slice(0, nextBoundary) : after).trim();
}

async function writeSnapshot(name: string, payload: Record<string, unknown>) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(
    path.join(LOG_DIR, `${Date.now()}-${name}.json`),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

async function waitForTurnDrained(page: Page, timeout = 180_000) {
  const root = page.getByTestId("chat-input-root");
  await expect(root).toHaveAttribute("data-agent-awaiting", "false", { timeout });
  await expect(root).toHaveAttribute("data-agent-queued-count", "0", { timeout: 10_000 });
}

async function sendPromptAndCapture(
  page: Page,
  name: string,
  prompt: string,
  expected: RegExp,
  timeout = 180_000
) {
  const before = await bodyText(page);
  const transcriptStart = await transcriptLength(page);
  const input = runningChatInput(page);
  await input.focus();
  await input.fill(prompt);
  await input.press("Enter");
  await waitForTurnDrained(page, timeout);
  const after = await bodyText(page);
  const transcript = await transcriptSince(page, transcriptStart);
  const assistant = latestAssistantBlock(transcript);
  const delta = after.startsWith(before) ? after.slice(before.length).trim() : after;
  await writeSnapshot(name, {
    prompt,
    expected: String(expected),
    assistant,
    transcript,
    delta,
    afterTail: after.slice(-6000),
  });
  return { before, after, delta, transcript, assistant };
}

function expectNoRawToolArtifacts(text: string) {
  expect(text).not.toMatch(/<tool_call>|<\/tool_call>|<TOOLCALL>|<\/TOOLCALL>/i);
  expect(text).not.toMatch(/<<<\s*TOOL\s*>>>|<<<\s*END\s*>>>/i);
  expect(text).not.toMatch(/"tool"\s*:\s*"(make_dir|write_file|list_dir|read_file|run_shell)"/i);
}

test.describe.serial("live default-model agent quality", () => {
  test.skip(!TESTING_OPENROUTER_API_KEY, "Set TESTING_OPENROUTER_API_KEY to run live quality checks.");
  test.setTimeout(600_000);

  test("direct answer, tool sequence, and final stop are stable", async ({ page }) => {
    await page.goto("/");
    await clearBrowserStorage(page);
    await page.goto("/");
    await waitForProfilesLoaded(page);
    await createProfile(page, PROFILE_NAME);
    await configureOpenRouterApiKey(page, TESTING_OPENROUTER_API_KEY, PROFILE_NAME);
    await page.getByRole("button", { name: new RegExp(PROFILE_NAME) }).first().click();
    await launchDefaultAgent(page, "Live Quality User", true, PROFILE_NAME);
    await expect(page.getByTestId("chat-input-root")).toHaveAttribute(
      "data-agent-runtime-status",
      "running",
      { timeout: CHAT_READY_TIMEOUT_MS }
    );

    const direct = await sendPromptAndCapture(
      page,
      "01-direct-answer",
      "Reply with exactly LIVE_DIRECT_OK_TOKEN and no other words.",
      /LIVE_DIRECT_OK_TOKEN/,
      120_000
    );
    expect(direct.assistant).toBe("LIVE_DIRECT_OK_TOKEN");
    expectNoRawToolArtifacts(direct.transcript);

    const fastapi = await sendPromptAndCapture(
      page,
      "02-fastapi-project",
      [
        "Create a minimal FastAPI project in projects/live-quality-fastapi.",
        "Use the file tools to create main.py with two routes: / and /items/{item_id}.",
        "Then verify the file exists with a directory or file-reading tool.",
        "Do not stop after announcing the next step.",
        "When verified, reply exactly FASTAPI_PROJECT_READY.",
      ].join(" "),
      /FASTAPI_PROJECT_READY/,
      240_000
    );
    expect(fastapi.transcript).toMatch(/▸\s*make_dir/i);
    expect(fastapi.transcript).toMatch(/▸\s*write_file/i);
    expect(fastapi.transcript).toMatch(/▸\s*(list_dir|read_file|tree)/i);
    expect(fastapi.assistant).toContain("FASTAPI_PROJECT_READY");
    expect(fastapi.assistant).not.toContain("LIVE_DIRECT_OK_TOKEN");
    expect((fastapi.transcript.match(/▸\s*make_dir/gi) || []).length).toBe(1);
    expectNoRawToolArtifacts(fastapi.transcript);

    const list = await sendPromptAndCapture(
      page,
      "03-list-and-stop",
      "List project files using a filesystem tool, then give one concise final sentence ending with LIST_DONE_TOKEN.",
      /LIST_DONE_TOKEN/,
      180_000
    );
    expect(list.transcript).toMatch(/▸\s*(list_dir|tree)/i);
    expect(list.assistant).toMatch(/LIST_DONE_TOKEN$/);
    expect(list.assistant).not.toContain("LIVE_DIRECT_OK_TOKEN");
    expect(list.assistant).not.toContain("FASTAPI_PROJECT_READY");
    expectNoRawToolArtifacts(list.transcript);

    const stableAfter = await transcriptLength(page);
    await page.waitForTimeout(5000);
    const stableLater = await transcriptLength(page);
    expect(stableLater).toBe(stableAfter);
  });
});
