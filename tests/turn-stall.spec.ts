import { expect, test } from "@playwright/test";
import {
  CHAT_READY_TIMEOUT_MS,
  clearBrowserStorage,
  countToolCalls,
  launchDefaultAgent,
  sendPromptAndWait,
  waitForProfilesLoaded,
} from "./e2e-helpers";
import { createMockLlmResponseQueue } from "./fixtures/mock-llm-sse.js";
import {
  MOCK_FOLLOWUP_RESPONSE,
  MOCK_PLAIN_TOOL_HINTS_RESPONSE,
} from "./fixtures/turn-stall-scenarios.js";

function isChatCompletionProxy(body: unknown): body is { url?: string } {
  const url = String((body as { url?: string })?.url || "");
  return url.includes("/chat/completions");
}

test.describe("turn stall regression (mocked LLM)", () => {
  test.setTimeout(360_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearBrowserStorage(page);
    await page.goto("/");
    await waitForProfilesLoaded(page);
  });

  test("plain tree/. tool hints execute browse_workspace without no_tools_no_continue", async ({
    page,
  }) => {
    const nextMockBody = createMockLlmResponseQueue([
      "Hey — ready when you are.",
      MOCK_PLAIN_TOOL_HINTS_RESPONSE,
      MOCK_FOLLOWUP_RESPONSE,
    ]);

    await page.route("**/api/proxy", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      let body: unknown;
      try {
        body = request.postDataJSON();
      } catch {
        await route.continue();
        return;
      }
      if (!isChatCompletionProxy(body)) {
        await route.continue();
        return;
      }
      const sseBody = nextMockBody();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: 200,
          statusText: "OK",
          contentType: "text/event-stream; charset=utf-8",
          body: sseBody,
        }),
      });
    });

    await launchDefaultAgent(page);
    await expect(page.getByTestId("chat-input-root")).toHaveAttribute(
      "data-agent-runtime-status",
      "running",
      { timeout: CHAT_READY_TIMEOUT_MS }
    );

    const { transcript } = await sendPromptAndWait(page, "continue working on article", 240_000);

    const userMarker = "└ continue working on article";
    const markerIndex = transcript.lastIndexOf(userMarker);
    expect(markerIndex, "expected user prompt in transcript").toBeGreaterThanOrEqual(0);
    const userTurn = transcript.slice(markerIndex);

    expect(countToolCalls(userTurn, "browse_workspace")).toBeGreaterThan(0);
    expect(userTurn).not.toMatch(/stopped:\s*no_tools_no_continue/i);
    expect(userTurn).toMatch(/STALL_TEST_OK/i);
  });
});
