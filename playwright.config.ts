import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

/** `.env.local` overrides `.env` — picks up `TESTING_OPENROUTER_API_KEY` for real-chat Playwright tests. */
loadDotenv({ path: path.resolve(process.cwd(), ".env"), quiet: true });
loadDotenv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
  quiet: true,
});

const port = String(process.env.PLAYWRIGHT_PORT || "5173").trim();
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  /** Node unit tests live in `tests/*.test.ts`; only `*.spec.ts` are browser E2E. */
  testMatch: "**/*.spec.ts",
  /** WebContainer cold boot + onboarding + first LLM turn can exceed 3 minutes locally/CI. */
  timeout: 300_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  webServer: {
    command: `VITE_WEBAGENT_DEBUG_LOG=1 npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 90_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        viewport: { width: 1400, height: 900 },
      },
    },
  ],
});
