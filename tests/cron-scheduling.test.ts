import test from "node:test";
import assert from "node:assert/strict";

import {
  cronOutputDestination,
  cronNextEligibleAtMs,
  enrichCronJobForList,
} from "../dist/agent-runtime/cron-scheduling.js";

const HEARTBEAT_MS = 30 * 60 * 1000;

test("cronOutputDestination maps delivery modes", () => {
  assert.equal(cronOutputDestination({ delivery: "silent" }), "Silent");
  assert.equal(cronOutputDestination({ delivery: "terminal" }), "Web UI");
  assert.equal(
    cronOutputDestination({ delivery: "terminal", notifyChannel: "telegram:123" }),
    "Web UI + Telegram"
  );
  assert.equal(
    cronOutputDestination({ delivery: "email", deliveryEmailTo: "a@b.com" }),
    "Email"
  );
});

test("enrichCronJobForList reports no manual run", () => {
  const now = 1_700_000_000_000;
  const enriched = enrichCronJobForList(
    { id: "hunt", everyMinutes: 120, lastRunAt: now - 60_000, delivery: "terminal" },
    HEARTBEAT_MS,
    now
  );
  assert.equal(enriched.manualRunSupported, false);
  assert.equal(enriched.schedulingMode, "heartbeat_gated");
  assert.equal(enriched.heartbeatIntervalMinutes, 30);
  assert.equal(enriched.outputDestination, "Web UI");
  assert.ok(enriched.nextEligibleAtMs >= now);
});

test("cron_list returns enriched jobs", async () => {
  const { cronListTool } = await import("../dist/agent-runtime/tools/remote-tools.js");
  const out = await cronListTool({}, {});
  assert.equal(out.scheduling?.manualRunSupported, false);
  assert.equal(out.scheduling?.schedulingMode, "heartbeat_gated");
  if (out.jobs?.length) {
    assert.equal(out.jobs[0].manualRunSupported, false);
    assert.ok(out.jobs[0].outputDestination);
  }
});
