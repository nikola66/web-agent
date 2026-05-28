import { expect, type Page } from "@playwright/test";

/** Cold WebContainer boot (~90s) + first-run onboarding needs more than default test budgets. */
export const CHAT_READY_TIMEOUT_MS = 240_000;

/** Normalize key from `.env.local` (quotes / stray whitespace break OpenRouter). */
export function testingOpenRouterApiKey(): string {
  let k = String(process.env.TESTING_OPENROUTER_API_KEY ?? "").trim();
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

export function testingDirectusUrl(): string {
  return String(process.env.TESTING_DIRECTUS_URL ?? "https://hub.aratech.ae").trim();
}

export function testingDirectusToken(): string {
  let t = String(process.env.TESTING_DIRECTUS_TOKEN ?? "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export function countToolCalls(transcript: string, tool: string): number {
  const re = new RegExp(`▸(?:\\s*[^\\s]+\\s+)?${tool}\\b`, "gi");
  return (transcript.match(re) || []).length;
}

function proxyOriginForPage(page: Page): string {
  try {
    const u = new URL(page.url());
    if (u.protocol.startsWith("http")) return u.origin;
  } catch {
    /* fall through */
  }
  const port = String(process.env.PLAYWRIGHT_PORT || "5173").trim();
  return `http://127.0.0.1:${port}`;
}

/** Probe Directus REST via the dev-server CORS proxy (same path as web_fetch in the browser). */
export async function directusReachableViaProxy(
  page: Page,
  baseUrl: string,
  token: string
): Promise<boolean> {
  const root = baseUrl.replace(/\/$/, "");
  const probeUrl = `${root}/collections?limit=1`;
  const origin = proxyOriginForPage(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await page.request.post(`${origin}/api/proxy`, {
        data: {
          method: "GET",
          url: probeUrl,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        },
      });
      const payload = (await res.json()) as { status?: number; body?: string; error?: string };
      if (payload.error) continue;
      const status = Number(payload.status);
      if (status >= 200 && status < 300) return true;
      const body = String(payload.body || "");
      if (body.includes('"data"') && !body.includes("Just a moment")) return true;
    } catch {
      /* retry */
    }
    await page.waitForTimeout(800);
  }
  return false;
}

export async function ensureProfilesTab(page: Page) {
  await page.getByRole("button", { name: "Profiles" }).click();
}

/** Pencil control only — avoids matching the outer profile card `role="button"` that embeds the same substring in its accessible name. */
export function editProfileButton(page: Page, profileName: string) {
  return page.locator(`button[aria-label="Edit ${profileName}"]`);
}

export function runningChatInput(page: Page) {
  return page.getByPlaceholder("Type message (Enter to send, @ to reference files)");
}

/** Matches chat input in idle or running states (placeholder changes). */
export function anyChatInput(page: Page) {
  return page.locator(
    'textarea[placeholder="Type message (Enter to send, @ to reference files)"], textarea[placeholder="Launch the agent to start chatting"], textarea[placeholder="Press Enter to accept default, or type a name"]'
  );
}

/** After agent reaches running state, chat input is enabled with the running placeholder. */
export async function expectChatReady(page: Page, timeout = 30_000) {
  const any = anyChatInput(page);
  await expect(any).toBeVisible({ timeout });
  await expect(any).toBeEnabled({ timeout });
  const ready = runningChatInput(page);
  await expect(ready).toBeVisible({ timeout });
  await expect(ready).toBeEnabled({ timeout });
}

export async function waitForProfilesLoaded(page: Page) {
  await expect(page.getByText("Loading profiles…")).not.toBeVisible({ timeout: 20_000 }).catch(() => {});
}

/**
 * Per-profile launch control on the card toolbar. The outer profile row is also `role="button"`
 * and its accessible name ends with "… Edit … Start" / "… Stop", so `name: /Start/` matches the
 * wrong node and `.first()` never launches the agent.
 */
export function profileLaunchControl(page: Page, action: "Start" | "Stop") {
  return page.getByRole("button", { name: action, exact: true });
}

/** Sidebar card for a profile (toolbar hosts Start/Stop). */
export function profileCardByName(page: Page, profileName: string) {
  return page
    .locator("p.text-sm.font-semibold")
    .getByText(profileName, { exact: true })
    .locator(
      "xpath=ancestor::div[contains(@class,'relative') and contains(@class,'w-full')][1]"
    );
}

/** Profile row that is the active selection (stable marker; inline boxShadow text is not queryable in all engines). */
export function activeProfileCard(page: Page) {
  return page.locator('[data-active-profile="true"]');
}

export async function clickStartAgent(page: Page, profileName?: string) {
  await waitForProfilesLoaded(page);
  await ensureProfilesTab(page);
  const card = profileName ? profileCardByName(page, profileName) : activeProfileCard(page);
  await card.getByRole("button", { name: "Start", exact: true }).click();
}

export async function clickStopAgent(page: Page, profileName?: string) {
  await ensureProfilesTab(page);
  if (profileName) {
    await profileCardByName(page, profileName)
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    return;
  }
  await profileLaunchControl(page, "Stop").first().click();
}

export async function configureOpenCodeProvider(page: Page, profileName?: string) {
  await waitForProfilesLoaded(page);
  await ensureProfilesTab(page);
  if (profileName) {
    await editProfileButton(page, profileName).click();
  } else {
    await page.locator('button[aria-label^="Edit "]').first().click();
  }
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const providerCombo = dialog.locator('[aria-haspopup="listbox"]').nth(1);
  await providerCombo.click();
  await dialog.getByPlaceholder("Search provider...").fill("OpenCode");
  await dialog.getByRole("option", { name: "OpenCode (free, limited)" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

export async function configureOpenRouterApiKey(page: Page, apiKey: string, profileName?: string) {
  await waitForProfilesLoaded(page);
  await ensureProfilesTab(page);
  if (profileName) {
    await editProfileButton(page, profileName).click();
  } else {
    await page.locator('button[aria-label^="Edit "]').first().click();
  }
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  /** Smoke profiles may use Custom provider; OpenRouter tests need OpenRouter + sk-or key field. */
  const providerCombo = dialog.locator('[aria-haspopup="listbox"]').nth(1);
  await providerCombo.click();
  await dialog.getByPlaceholder("Search provider...").fill("OpenRouter");
  await dialog.getByRole("option", { name: "OpenRouter" }).click();
  await dialog.getByLabel("Model override").fill("");
  await dialog.getByPlaceholder("sk-or-...").fill(apiKey);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

export async function completeFirstRunSetup(page: Page, userName = "Smoke User") {
  /** Boot/install phases keep placeholder "Launch…"; input is still enabled during booting. */
  const chatInput = anyChatInput(page);
  await expect(chatInput).toBeVisible({ timeout: CHAT_READY_TIMEOUT_MS });
  await expect(chatInput).toBeEnabled({ timeout: CHAT_READY_TIMEOUT_MS });

  /**
   * Onboarding prints to xterm (canvas); Playwright cannot `getByText` it. The UI exposes
   * `data-agent-onboarding` from the adapter's ONBOARDING markers instead.
   */
  const chatRoot = page.getByTestId("chat-input-root");
  let onboarding = (await chatRoot.getAttribute("data-agent-onboarding")) === "true";
  if (!onboarding) {
    try {
      await expect(chatRoot).toHaveAttribute("data-agent-onboarding", "true", { timeout: 90_000 });
      onboarding = true;
    } catch {
      return;
    }
  }
  await chatInput.focus();
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await chatInput.fill(userName);
  await page.keyboard.press("Enter");
  await expect(chatRoot).toHaveAttribute("data-agent-onboarding", "false", { timeout: 60_000 });
}

/** Survives profile storage clears; adapter reads this when spawning the Nodebox agent. */
export async function enableE2eAutoApproveTools(page: Page) {
  await page.evaluate(() => sessionStorage.setItem("WEBAGENT_AUTO_APPROVE_TOOLS", "1"));
}

export async function clearBrowserStorage(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    if (typeof caches !== "undefined") {
      await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
    }

    const databaseNames =
      typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).map((db) => db.name).filter(Boolean)
        : ["keyval-store"];
    await Promise.all(
      databaseNames.map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name!);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })
      )
    );

    if (navigator.storage && "getDirectory" in navigator.storage) {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true });
      }
    }
  });
}

async function approvePendingToolGate(page: Page) {
  const root = page.getByTestId("chat-input-root");
  const pendingAttr = await root.getAttribute("data-agent-pending-tool-confirm");
  const gateVisible = await page.getByText("Permission required").isVisible().catch(() => false);
  if (pendingAttr !== "true" && !gateVisible) return;
  const input = runningChatInput(page);
  for (let i = 0; i < 3; i++) {
    await input.focus();
    await input.fill("yes");
    await input.press("Enter");
    await page.waitForTimeout(900);
    const still = await page.getByText("Permission required").isVisible().catch(() => false);
    if (!still && (await root.getAttribute("data-agent-pending-tool-confirm")) !== "true") return;
  }
}

export async function waitForTurnDrained(page: Page, timeout = 180_000) {
  const root = page.getByTestId("chat-input-root");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await approvePendingToolGate(page);
    const awaiting = await root.getAttribute("data-agent-awaiting");
    const queued = await root.getAttribute("data-agent-queued-count");
    if (awaiting === "false" && queued === "0") return;
    await page.waitForTimeout(400);
  }
  await expect(root).toHaveAttribute("data-agent-awaiting", "false", { timeout: 5_000 });
  await expect(root).toHaveAttribute("data-agent-queued-count", "0", { timeout: 5_000 });
}

export async function transcriptLength(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __WEBAGENT_LIVE_TRANSCRIPT__?: unknown[] };
    return Array.isArray(w.__WEBAGENT_LIVE_TRANSCRIPT__) ? w.__WEBAGENT_LIVE_TRANSCRIPT__.length : 0;
  });
}

export async function transcriptSince(page: Page, index: number): Promise<string> {
  return await page.evaluate((from) => {
    const w = window as typeof window & { __WEBAGENT_LIVE_TRANSCRIPT__?: Array<{ data?: string }> };
    return (w.__WEBAGENT_LIVE_TRANSCRIPT__ || [])
      .slice(from)
      .map((entry) => String(entry?.data || ""))
      .join("");
  }, index);
}

export async function sendPromptAndWait(page: Page, prompt: string, timeout = 180_000) {
  const beforeTranscript = await transcriptLength(page);
  const chatInput = runningChatInput(page);
  await chatInput.focus();
  await chatInput.fill(prompt);
  await chatInput.press("Enter");
  await waitForTurnDrained(page, timeout);
  return {
    transcript: await transcriptSince(page, beforeTranscript),
  };
}

export async function launchDefaultAgent(
  page: Page,
  userName = "Smoke User",
  expectOnboarding = true,
  profileName?: string
) {
  await clickStartAgent(page, profileName);
  if (expectOnboarding) await completeFirstRunSetup(page, userName);
  await expectChatReady(page, CHAT_READY_TIMEOUT_MS);
}

export async function stopAgentAndWait(page: Page) {
  await clickStopAgent(page);
  await expect(anyChatInput(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder("Launch the agent to start chatting")).toBeVisible({
    timeout: 30_000,
  });
}

export async function expectProviderInProfileEditor(page: Page, providerLabel: string) {
  await ensureProfilesTab(page);
  await page.locator('button[aria-label^="Edit "]').first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: providerLabel }).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
}

export async function expectDefaultProviderInProfileEditor(page: Page) {
  await expectProviderInProfileEditor(page, "OpenCode (free, limited)");
}

export async function createProfile(page: Page, name: string) {
  await ensureProfilesTab(page);
  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "New profile" });
  await expect(dialog).toBeVisible();
  await dialog.locator("input").first().fill(name);
  await dialog.getByRole("button", { name: "Edit system prompt" }).click();
  await dialog.locator("textarea").fill("You are the smoke-test profile. Keep replies short and factual.");
  const providerCombo = dialog.locator('[aria-haspopup="listbox"]').nth(1);
  await providerCombo.click();
  await dialog.getByPlaceholder("Search provider...").fill("custom");
  /** SearchableSelect renders choices as `role="option"` on `<button>` nodes. */
  await dialog.getByRole("option", { name: "Custom (OpenAI-compatible)" }).click();
  await dialog.getByLabel("Model override").fill("local-smoke-model");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(editProfileButton(page, name)).toBeVisible();
}

export async function assertProfileHasCustomModel(page: Page, profileName: string, model: string) {
  await ensureProfilesTab(page);
  await editProfileButton(page, profileName).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Model override")).toHaveValue(model);
  await dialog.getByRole("button", { name: "Close" }).click();
}
