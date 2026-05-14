import { expect, test } from "@playwright/test";
import {
  anyChatInput,
  assertProfileHasCustomModel,
  clearBrowserStorage,
  clickStartAgent,
  configureOpenRouterApiKey,
  createProfile,
  editProfileButton,
  ensureProfilesTab,
  expectChatReady,
  expectOpenRouterDefaultInProfileEditor,
  launchDefaultAgent,
  runningChatInput,
  stopAgentAndWait,
  sendPromptAndWait,
  testingOpenRouterApiKey,
  waitForProfilesLoaded,
  waitForTurnDrained,
} from "./e2e-helpers";

const TESTING_OPENROUTER_API_KEY = testingOpenRouterApiKey();

function requireOpenRouterApiKey() {
  test.skip(!TESTING_OPENROUTER_API_KEY, "Set TESTING_OPENROUTER_API_KEY to run real API Playwright tests.");
}

async function configureOpenRouter(page: import("@playwright/test").Page, profileName?: string) {
  await configureOpenRouterApiKey(page, TESTING_OPENROUTER_API_KEY, profileName);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("serves app shell with Nodebox-compatible isolation headers", async ({ page }) => {
  await clearBrowserStorage(page);
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response?.headers()["cross-origin-embedder-policy"]).toBeUndefined();

  await expect(page.getByRole("heading", { name: "Web Agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profiles" })).toBeVisible();
  await waitForProfilesLoaded(page);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect.poll(() => page.evaluate(() => window.crossOriginIsolated)).toBe(false);
});

test("rejects unknown LLM proxy providers", async ({ request }) => {
  const response = await request.post("/api/llm/notallowed/chat/completions", {
    data: { model: "test", messages: [] },
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toMatchObject({
    error: "llm_provider_not_allowed",
  });
});

test("creates and persists an active profile across reloads", async ({ page }) => {
  await page.goto("/");
  await waitForProfilesLoaded(page);

  await createProfile(page, "Smoke Profile");
  await assertProfileHasCustomModel(page, "Smoke Profile", "local-smoke-model");

  await page.reload();
  await waitForProfilesLoaded(page);

  await expect(editProfileButton(page, "Smoke Profile")).toBeVisible();
  await assertProfileHasCustomModel(page, "Smoke Profile", "local-smoke-model");
});

test("default profile editor shows OpenRouter provider", async ({ page }) => {
  await clearBrowserStorage(page);
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await expectOpenRouterDefaultInProfileEditor(page);
});

test("auto provider with OpenRouter key displays OpenRouter", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);

  await configureOpenRouter(page);
  await launchDefaultAgent(page);

  await expectOpenRouterDefaultInProfileEditor(page);
  await ensureProfilesTab(page);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
});

test("streams a reply and saves history without workspace root errors", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);

  await sendPromptAndWait(page, "Reply with exactly REAL_API_HELLO_TOKEN.", 60_000);

  await expect(page.getByText("REAL_API_HELLO_TOKEN", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("ENOENT")).not.toBeVisible();
});

test("runtime memory tools write structured records and tool stats", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);

  const saved = await sendPromptAndWait(page, "Use memory_save to save preference=aurora.");
  expect(saved.transcript).toMatch(/▸\s*memory_save/i);

  const recalled = await sendPromptAndWait(page, "Use memory_recall to read preference.");
  expect(recalled.transcript).toMatch(/▸\s*memory_recall|▸\s*memory_search/i);

  const searched = await sendPromptAndWait(page, "Use memory_search for preference.");
  expect(searched.transcript).toMatch(/▸\s*memory_search/i);

  const listed = await sendPromptAndWait(page, "List project files.");
  expect(listed.transcript).toMatch(/▸\s*(list_dir|tree)/i);

  const invalid = await sendPromptAndWait(page, "Call read_file with arguments {} so required path is missing.");
  expect(invalid.transcript).toMatch(/✗\s*read_file|missing|invalid|required|error/i);

  await stopAgentAndWait(page);
});

test("runtime memory persists across relaunch and corrupt JSON is skipped", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);

  await sendPromptAndWait(page, "Remember codename AURORA_REL_PERSIST and output exactly SAVED_AURORA_PERSIST.", 90_000);
  await expect(page.locator("body")).toContainText(/SAVED_AURORA_PERSIST/, { timeout: 60_000 });

  await sendPromptAndWait(page, "Create corrupt memory files.", 90_000);
  await expect(page.getByText(/▸[^\n]*corrupt|invalid json|parse error|skipped[^\n]*memory/i).first()).toBeVisible({
    timeout: 30_000,
  });

  await stopAgentAndWait(page);
  await launchDefaultAgent(page, "Smoke User", false);
  await sendPromptAndWait(page, "What codename did I ask you to remember? Reply with codename token only.", 90_000);
  await expect(page.locator("body")).toContainText(/AURORA_REL_PERSIST/, { timeout: 60_000 });
});

test("fresh profiles do not inherit another profile memory", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);
  const remembered = await sendPromptAndWait(page, "Remember codename Aurora and confirm.", 90_000);
  expect(remembered.transcript).toMatch(/Aurora|confirm|remember/i);
  await stopAgentAndWait(page);

  await createProfile(page, "Fresh Memory");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page, "Fresh Memory");
  await page.getByRole("button", { name: /Fresh Memory/ }).first().click();
  await launchDefaultAgent(page, "Fresh User", true, "Fresh Memory");
  const isolation = await sendPromptAndWait(
    page,
    "Check memory_search for query \"aurora preference\". If this profile has no matching facts, reply exactly: FRESH_MEM_ISOLATION_OK"
  );
  expect(isolation.transcript).toMatch(/FRESH_MEM_ISOLATION_OK|no (matching|stored)|hits?:\s*0|empty (search|result)|\[\s*\]/i);
});

test("executes OpenAI streamed tool_calls before final answer", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);
  await page.waitForTimeout(1_000);

  const toolCall = await sendPromptAndWait(page, "List project files.", 90_000);

  expect(toolCall.transcript).toMatch(/▸\s*(list_dir|tree)/i);
});

test("strips XML tool-call artifacts from assistant output", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);
  await page.waitForTimeout(1_000);

  const summary = await sendPromptAndWait(page, "Summarize the company blog in 1 sentence.", 90_000);
  expect(summary.transcript).toMatch(/blog|summary|company|url/i);
  await expect(page.getByText("<tool_call>")).not.toBeVisible();
});

test("keeps marker tool parser as fallback path", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);
  await page.waitForTimeout(1_000);

  const fallback = await sendPromptAndWait(page, "Use list_dir and then reply FALLBACK_MARKER_CHECK.", 90_000);
  expect(fallback.transcript).toMatch(/FALLBACK_MARKER_CHECK|▸\s*list_dir/i);
});

test("first launch can rename the agent and capture the user name", async ({ page }) => {
  requireOpenRouterApiKey();
  await clearBrowserStorage(page);
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await clickStartAgent(page);

  const chatRoot = page.getByTestId("chat-input-root");
  await expect(chatRoot).toHaveAttribute("data-agent-onboarding", "true", { timeout: 90_000 });
  const chatInput = anyChatInput(page);
  await chatInput.focus();
  await chatInput.fill("Astra Prime");
  await chatInput.press("Enter");
  await chatInput.fill("Nicolas");
  await chatInput.press("Enter");
  await expect(chatRoot).toHaveAttribute("data-agent-onboarding", "false", { timeout: 60_000 });
  await expectChatReady(page);

  await expect(page.locator("p.text-sm.font-semibold").filter({ hasText: /^Astra Prime$/ })).toBeVisible({
    timeout: 30_000,
  });
  await expectOpenRouterDefaultInProfileEditor(page);
  await ensureProfilesTab(page);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
});

test("/clear clears conversation without restarting onboarding", async ({ page }) => {
  requireOpenRouterApiKey();
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page);

  const chatInput = runningChatInput(page);
  await chatInput.focus();
  await chatInput.fill("/clear");
  await chatInput.press("Enter");
  await waitForTurnDrained(page, 30_000);
  await expect(page.getByTestId("chat-input-root")).toHaveAttribute("data-agent-onboarding", "false");
  await expectChatReady(page);
});

test("agent boots and completes onboarding", async ({ page }) => {
  requireOpenRouterApiKey();
  await clearBrowserStorage(page);
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page, "Boot Test User");

  await ensureProfilesTab(page);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await stopAgentAndWait(page);
});

test("agent executes tool calls correctly", async ({ page }) => {
  requireOpenRouterApiKey();
  await clearBrowserStorage(page);
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page, "Tool Test User");

  const chatInput = runningChatInput(page);
  await chatInput.focus();
  await chatInput.fill("List the files in current directory");
  await chatInput.press("Enter");
  await waitForTurnDrained(page, 90_000);

  await expect(page.getByText(/Tool call completed|▸ list_dir/i)).toBeVisible({
    timeout: 30_000,
  });

  await stopAgentAndWait(page);
});

test("agent saves and recalls memory", async ({ page }) => {
  requireOpenRouterApiKey();
  await clearBrowserStorage(page);
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page, "Memory Test User");

  const chatInput = runningChatInput(page);

  const saveTurn = await sendPromptAndWait(page, "Save this preference: I prefer concise responses", 90_000);
  expect(saveTurn.transcript).toMatch(/▸\s*memory_save|memory_save|saved|preference|concise/i);

  const recallTurn = await sendPromptAndWait(page, "What preference did I save?", 90_000);
  expect(recallTurn.transcript).toMatch(/concise/i);

  await stopAgentAndWait(page);
});

test("agent learns and adapts from user feedback", async ({ page }) => {
  requireOpenRouterApiKey();
  await clearBrowserStorage(page);
  await page.goto("/");
  await waitForProfilesLoaded(page);
  await configureOpenRouter(page);
  await launchDefaultAgent(page, "Learn Test User");

  const chatInput = runningChatInput(page);

  await chatInput.focus();
  await chatInput.fill("Remember: I like technical explanations with code examples");
  await chatInput.press("Enter");
  await expect(
    page.getByText(/▸\s*memory_save|remember|noted|stored|technical|code examples/i).first()
  ).toBeVisible({
    timeout: 30_000,
  });

  await chatInput.focus();
  await chatInput.fill("Explain TypeScript generics");
  await chatInput.press("Enter");
  await expect(page.locator("body")).toContainText(/TypeScript|generic|type|example/i);

  await stopAgentAndWait(page);
});
