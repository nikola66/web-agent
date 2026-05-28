import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  CHAT_READY_TIMEOUT_MS,
  clearBrowserStorage,
  configureOpenRouterApiKey,
  countToolCalls,
  createProfile,
  directusReachableViaProxy,
  launchDefaultAgent,
  runningChatInput,
  testingDirectusToken,
  testingDirectusUrl,
  testingOpenRouterApiKey,
  waitForProfilesLoaded,
  waitForTurnDrained,
} from "./e2e-helpers";

const TESTING_OPENROUTER_API_KEY = testingOpenRouterApiKey();
const TESTING_DIRECTUS_URL = testingDirectusUrl();
const TESTING_DIRECTUS_TOKEN = testingDirectusToken();
const LOG_DIR = path.resolve(process.cwd(), "test-results/skill-directus-crud");
const PROFILE_NAME = "DirectusSkill";
const SKILL_REPO_URL = "https://github.com/nikola66/directus-skill";
const CRUD_MARKER = `E2E_BLOG_CRUD_${Date.now()}`;

function requireLiveCredentials() {
  test.skip(!TESTING_OPENROUTER_API_KEY, "Set TESTING_OPENROUTER_API_KEY to run live Directus skill E2E.");
  test.skip(!TESTING_DIRECTUS_TOKEN, "Set TESTING_DIRECTUS_TOKEN to run live Directus skill E2E.");
}

function redact(text: string): string {
  const token = TESTING_DIRECTUS_TOKEN;
  let out = String(text || "")
    .replace(/sk-or-v1-[a-z0-9]+/gi, "sk-or-v1-[redacted]")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  if (token) {
    out = out.split(token).join("[directus-token-redacted]");
  }
  return out;
}

async function bodyText(page: Page) {
  return redact(await page.locator("body").innerText({ timeout: 10_000 }));
}

async function transcriptLength(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const w = window as typeof window & { __WEBAGENT_LIVE_TRANSCRIPT__?: unknown[] };
    return Array.isArray(w.__WEBAGENT_LIVE_TRANSCRIPT__) ? w.__WEBAGENT_LIVE_TRANSCRIPT__.length : 0;
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

async function writeSnapshot(name: string, payload: Record<string, unknown>) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(
    path.join(LOG_DIR, `${Date.now()}-${name}.json`),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

async function sendPromptAndCapture(
  page: Page,
  name: string,
  prompt: string,
  timeout = 360_000
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
  const delta = after.startsWith(before) ? after.slice(before.length).trim() : after;
  await writeSnapshot(name, { prompt, transcript, delta, afterTail: after.slice(-8000) });
  return { before, after, delta, transcript };
}

test.describe.serial("directus skill install and CMS CRUD (live)", () => {
  requireLiveCredentials();
  test.setTimeout(900_000);

  test("installs remote skill with pyodide compat then runs blog CRUD via REST", async ({ page }) => {
    await page.goto("/");
    await clearBrowserStorage(page);
    await page.goto("/");
    await waitForProfilesLoaded(page);
    await createProfile(page, PROFILE_NAME);
    await configureOpenRouterApiKey(page, TESTING_OPENROUTER_API_KEY, PROFILE_NAME);
    await page.getByRole("button", { name: new RegExp(PROFILE_NAME) }).first().click();
    await launchDefaultAgent(page, "Directus E2E User", true, PROFILE_NAME);
    await expect(page.getByTestId("chat-input-root")).toHaveAttribute(
      "data-agent-runtime-status",
      "running",
      { timeout: CHAT_READY_TIMEOUT_MS }
    );

    const reachable = await directusReachableViaProxy(page, TESTING_DIRECTUS_URL, TESTING_DIRECTUS_TOKEN);
    test.skip(
      !reachable,
      `Directus at ${TESTING_DIRECTUS_URL} is not reachable via /api/proxy (Cloudflare or network).`
    );

    const install = await sendPromptAndCapture(
      page,
      "01-skill-install",
      [
        `Download, install, and adapt this skill for Web Agent / Pyodide compatibility: ${SKILL_REPO_URL}`,
        "Use skill_manage import_url or skill_bulk_save — do not create a new skill from scratch.",
        "After saving, call skill_view on the installed skill and skill_view imported-skill-compat.",
        "Adapt the procedure so CMS work uses web_fetch/web_post with Bearer auth (http-api), not pip install directus-skill or from directus import.",
        "When the skill is installed and you have confirmed the compat mapping, reply exactly DIRECTUS_SKILL_READY_TOKEN.",
      ].join(" "),
      420_000
    );

    expect(install.transcript).toMatch(/▸\s*skill_(manage|bulk_save)/i);
    expect(install.transcript).toMatch(/▸\s*skill_view/i);
    expect(install.delta).toMatch(/DIRECTUS_SKILL_READY_TOKEN/);

    const crud = await sendPromptAndCapture(
      page,
      "02-directus-crud",
      [
        `Directus URL: ${TESTING_DIRECTUS_URL}`,
        `Directus Token: ${TESTING_DIRECTUS_TOKEN}`,
        "Using the installed directus skill and skill_view http-api, run full CRUD on one blog/article collection:",
        "1) Discover collections and pick the blog posts (or articles) collection.",
        `2) CREATE a draft post titled "${CRUD_MARKER}" with minimal required fields.`,
        `3) UPDATE that record (e.g. append _UPDATED to title or change status).`,
        "4) DELETE the record (soft or hard delete).",
        "Use web_fetch with response_format api and web_post with Authorization Bearer — not run_python with the directus SDK.",
        "When create, update, and delete all succeeded, reply exactly DIRECTUS_CRUD_OK_TOKEN.",
      ].join(" "),
      480_000
    );

    const httpTools = countToolCalls(crud.transcript, "web_post") + countToolCalls(crud.transcript, "web_fetch");
    expect(httpTools, "expected REST calls via web_fetch/web_post").toBeGreaterThanOrEqual(2);
    expect(crud.transcript).not.toMatch(/ModuleNotFoundError:\s*No module named ['"]directus['"]/i);
    expect(crud.transcript).not.toMatch(/✗\s*run_python[^\n]*directus/i);
    expect(crud.delta).toMatch(/DIRECTUS_CRUD_OK_TOKEN/);
  });
});
