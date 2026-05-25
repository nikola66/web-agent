import test from "node:test";
import assert from "node:assert/strict";

import {
  groupMarketingActionsByApp,
  resolveToolkitVersion,
} from "../src/agent/runtime/tools/composio-tools.ts";

const API_KEY = String(process.env.WEBAGENT_COMPOSIO_API_KEY || "").trim();
const BASE_URL =
  String(process.env.WEBAGENT_COMPOSIO_V3_BASE_URL || process.env.WEBAGENT_COMPOSIO_API_BASE_URL || "").trim() ||
  "https://backend.composio.dev/api/v3";

async function fetchToolkitSlugs(app: string): Promise<string[]> {
  const version = resolveToolkitVersion(app, { env: process.env });
  const params = new URLSearchParams({
    toolkit_slug: app,
    limit: "500",
    toolkit_versions: version,
  });
  const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/tools?${params.toString()}`, {
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  assert.equal(res.ok, true, `tools list failed for ${app}: ${res.status} ${text.slice(0, 240)}`);
  const body = JSON.parse(text) as {
    items?: Array<{ slug?: string }>;
    data?: Array<{ slug?: string }> | { items?: Array<{ slug?: string }> };
  };
  const items = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.data?.items)
        ? body.data.items
        : [];
  return items.map((item) => String(item.slug || "").trim()).filter(Boolean);
}

test("MARKETING_ACTIONS slugs exist in live Composio catalog", { skip: !API_KEY }, async (t) => {
  const grouped = groupMarketingActionsByApp();
  for (const [app, actions] of Object.entries(grouped)) {
    await t.test(app, async () => {
      const slugs = new Set((await fetchToolkitSlugs(app)).map((slug) => slug.toUpperCase()));
      assert.ok(slugs.size > 0, `no tools returned for ${app}`);
      for (const { action, actionId } of actions) {
        assert.ok(
          slugs.has(actionId.toUpperCase()),
          `${action} -> ${actionId} missing from ${app} catalog (version=${resolveToolkitVersion(app, { env: process.env })})`
        );
      }
    });
  }
});
