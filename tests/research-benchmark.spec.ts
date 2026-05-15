import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
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
const LOG_DIR = path.resolve(process.cwd(), "test-results/research-benchmark");
const PROFILE_NAME = "ResearchBench";
const BENCHMARK_PROMPT =
  "Please help me find YouTubers in UAE and KSA posting about openclaw and hermes agent";
const GOLDEN_NAMES = [/Tech With Tim/i, /Metics Media/i, /Aliph/i, /Farhan/i];

function countTool(transcript: string, tool: string) {
  const re = new RegExp(`▸\\s*${tool}\\b`, "gi");
  return (transcript.match(re) || []).length;
}

test.describe("research benchmark (live)", () => {
  test.skip(!TESTING_OPENROUTER_API_KEY, "Set TESTING_OPENROUTER_API_KEY to run live research benchmark.");
  test.setTimeout(600_000);

  test("UAE/KSA creator discovery uses deep search and fetch", async ({ page }) => {
    await page.goto("/");
    await clearBrowserStorage(page);
    await page.goto("/");
    await waitForProfilesLoaded(page);
    await createProfile(page, PROFILE_NAME);
    await configureOpenRouterApiKey(page, TESTING_OPENROUTER_API_KEY, PROFILE_NAME);
    await page.getByRole("button", { name: new RegExp(PROFILE_NAME) }).first().click();
    await launchDefaultAgent(page, "Research Bench User", true, PROFILE_NAME);
    await expect(page.getByTestId("chat-input-root")).toHaveAttribute(
      "data-agent-runtime-status",
      "running",
      { timeout: CHAT_READY_TIMEOUT_MS }
    );

    const transcriptStart = await page.evaluate(() => {
      const w = window as typeof window & { __WEBAGENT_LIVE_TRANSCRIPT__?: unknown[] };
      return Array.isArray(w.__WEBAGENT_LIVE_TRANSCRIPT__) ? w.__WEBAGENT_LIVE_TRANSCRIPT__.length : 0;
    });

    const input = runningChatInput(page);
    await input.fill(BENCHMARK_PROMPT);
    await input.press("Enter");

    await expect(page.getByTestId("chat-input-root")).toHaveAttribute(
      "data-agent-awaiting",
      "false",
      { timeout: 360_000 }
    );

    const transcript = await page.evaluate((from) => {
      const w = window as typeof window & {
        __WEBAGENT_LIVE_TRANSCRIPT__?: Array<{ data?: string }>;
      };
      return (w.__WEBAGENT_LIVE_TRANSCRIPT__ || [])
        .slice(from)
        .map((e) => String(e?.data || ""))
        .join("");
    }, transcriptStart);

    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.writeFile(
      path.join(LOG_DIR, `${Date.now()}-transcript.txt`),
      transcript,
      "utf8"
    );

    const searches = countTool(transcript, "web_search");
    const fetches = countTool(transcript, "web_fetch");
    expect(searches, "expected multiple web_search calls").toBeGreaterThanOrEqual(4);
    expect(fetches, "expected at least two web_fetch calls").toBeGreaterThanOrEqual(2);
    const goldenHit = GOLDEN_NAMES.some((re) => re.test(transcript));
    if (!goldenHit) {
      console.warn(
        "research-benchmark: no golden entity in transcript (soft); configure search API for best results"
      );
    }
    expect(goldenHit, "expected a known creator name when search quality allows").toBe(true);
  });
});
