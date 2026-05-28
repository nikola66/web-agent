import fs from "node:fs/promises";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

loadDotenv({ path: path.resolve(process.cwd(), ".env"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: true, quiet: true });
import {
  CHAT_READY_TIMEOUT_MS,
  clearBrowserStorage,
  configureOpenCodeProvider,
  enableE2eAutoApproveTools,
  countToolCalls,
  createProfile,
  directusReachableViaProxy,
  launchDefaultAgent,
  stopAgentAndWait,
  runningChatInput,
  testingDirectusToken,
  testingDirectusUrl,
  waitForProfilesLoaded,
  waitForTurnDrained,
} from "./e2e-helpers";

const TESTING_DIRECTUS_URL = testingDirectusUrl();
const TESTING_DIRECTUS_TOKEN = testingDirectusToken();
const LOG_DIR = path.resolve(process.cwd(), "test-results/skill-directus-crud");
const PROFILE_NAME = "DirectusSkill";
const SKILL_REPO_URL = "https://github.com/nikola66/directus-skill";
const CRUD_MARKER = `E2E_BLOG_CRUD_${Date.now()}`;

function requireLiveCredentials() {
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

function combinedTranscript(payload: { transcript: string; delta: string }): string {
  return `${payload.transcript}\n${payload.delta}`.trim();
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
  return { before, after, delta, transcript, combined: combinedTranscript({ transcript, delta }) };
}

test.describe.serial("directus skill install and CMS CRUD (live)", () => {
  requireLiveCredentials();
  test.setTimeout(1_800_000);

  test("installs remote skill with pyodide compat then runs blog CRUD via REST", async ({ page }) => {
    await page.goto("/");
    await waitForProfilesLoaded(page);
    const reachable = await directusReachableViaProxy(page, TESTING_DIRECTUS_URL, TESTING_DIRECTUS_TOKEN);
    expect(reachable, `Directus at ${TESTING_DIRECTUS_URL} must be reachable via /api/proxy (check Cloudflare UA allowlist)`).toBe(
      true
    );
    await clearBrowserStorage(page);
    await page.goto("/");
    await enableE2eAutoApproveTools(page);
    await waitForProfilesLoaded(page);
    await createProfile(page, PROFILE_NAME);
    await configureOpenCodeProvider(page, PROFILE_NAME);
    await page.getByRole("button", { name: new RegExp(PROFILE_NAME) }).first().click();
    await launchDefaultAgent(page, "Directus E2E User", true, PROFILE_NAME);
    await stopAgentAndWait(page);
    await launchDefaultAgent(page, "Directus E2E User", false, PROFILE_NAME);
    await expect(page.getByTestId("chat-input-root")).toHaveAttribute(
      "data-agent-runtime-status",
      "running",
      { timeout: CHAT_READY_TIMEOUT_MS }
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

    expect(install.combined).toMatch(/▸(?:\s*[^\s]+\s+)?skill_(manage|bulk_save)/i);
    expect(install.combined).toMatch(/▸(?:\s*[^\s]+\s+)?skill_view/i);
    expect(install.combined).toMatch(/DIRECTUS_SKILL_READY_TOKEN/);

    const crud = await sendPromptAndCapture(
      page,
      "02-directus-crud",
      [
        `Directus URL: ${TESTING_DIRECTUS_URL}`,
        `Directus Token: ${TESTING_DIRECTUS_TOKEN}`,
        "Using the installed directus skill and skill_view http-api, run full CRUD on the Blog_Posts collection (hub uses Blog_Posts + Blog_Posts_Translations).",
        "1) If discovery is slow, use Blog_Posts with author and category ids from a prior successful list call.",
        `2) CREATE a draft post titled "${CRUD_MARKER}" with minimal required fields.`,
        `3) UPDATE that record (e.g. append _UPDATED to title or change status).`,
        "4) DELETE the record (soft or hard delete).",
        "Use web_fetch with response_format api and web_post with Authorization Bearer — not run_python with the directus SDK.",
        "When create, update, and delete all succeeded, reply exactly DIRECTUS_CRUD_OK_TOKEN.",
      ].join(" "),
      720_000
    );

    const httpTools = countToolCalls(crud.combined, "web_post") + countToolCalls(crud.combined, "web_fetch");
    expect(httpTools, "expected REST calls via web_fetch/web_post").toBeGreaterThanOrEqual(2);
    expect(crud.combined).not.toMatch(/ModuleNotFoundError:\s*No module named ['"]directus['"]/i);
    expect(crud.combined).not.toMatch(/✗\s*run_python[^\n]*directus/i);
    expect(crud.combined).toMatch(/DIRECTUS_CRUD_OK_TOKEN/);
  });
});
