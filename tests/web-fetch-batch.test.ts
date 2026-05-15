import test from "node:test";
import assert from "node:assert/strict";

import { webFetchTool } from "../dist/agent-runtime/tools/remote-tools.js";

test("webFetchTool rejects more than 5 urls", async () => {
  const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
  await assert.rejects(
    () => webFetchTool({ urls }, {}),
    /at most 5 URLs/
  );
});

test("webFetchTool requires url or urls", async () => {
  await assert.rejects(() => webFetchTool({}, {}), /`url` or `urls`/);
});
