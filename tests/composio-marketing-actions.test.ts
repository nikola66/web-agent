import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import { COMPOSIO_INTEGRATIONS } from "../src/core/composio-integrations.ts";
import {
  groupMarketingActionsByApp,
  listComposioMarketingActions,
  resolveToolkitVersion,
} from "../src/agent/runtime/tools/composio-tools.ts";

const SKILL_PATH = nodePath.join(process.cwd(), "src/capabilities/skills/composio-oauth/SKILL.md");

test("listComposioMarketingActions covers every grouped app entry", () => {
  const grouped = groupMarketingActionsByApp();
  const listed = listComposioMarketingActions();
  assert.equal(
    listed.length,
    Object.values(grouped).reduce((sum, items) => sum + items.length, 0)
  );
});

test("every curated composio action is documented in composio-oauth skill", async () => {
  const raw = await fs.readFile(SKILL_PATH, "utf8");
  for (const { action } of listComposioMarketingActions()) {
    assert.match(raw, new RegExp(`\`${action}\``), `${action} missing from composio-oauth skill`);
  }
});

test("linkedin curated actions are listed in composio integrations settings copy", () => {
  const linkedin = COMPOSIO_INTEGRATIONS.find((entry) => entry.app === "linkedin");
  assert.ok(linkedin);
  assert.match(linkedin!.operations.join(" "), /Create post/i);
  assert.match(linkedin!.operations.join(" "), /Share article or URL/i);
  assert.match(linkedin!.operations.join(" "), /Get my info/i);
});

test("resolveToolkitVersion prefers per-app env override", () => {
  const version = resolveToolkitVersion("linkedin", {
    env: {
      WEBAGENT_COMPOSIO_TOOLKIT_VERSION: "20260101_00",
      WEBAGENT_COMPOSIO_TOOLKIT_VERSION_LINKEDIN: "20260424_00",
    },
  });
  assert.equal(version, "20260424_00");
});

test("resolveToolkitVersion defaults to latest", () => {
  assert.equal(resolveToolkitVersion("linkedin", { env: {} }), "latest");
});
