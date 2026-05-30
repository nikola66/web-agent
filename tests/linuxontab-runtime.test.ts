import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SerialBridge } from "../src/runtimes/linuxontab/serial-bridge.ts";
import {
  getAgentRuntimeEnvValue,
  getSandboxRuntimeKind,
  isLinuxOnTabRuntimeEnabled,
} from "../src/runtimes/config.ts";

describe("linuxontab runtime config", () => {
  it("defaults to nodebox when env unset", () => {
    assert.equal(getSandboxRuntimeKind(), "nodebox");
    assert.equal(isLinuxOnTabRuntimeEnabled(), false);
    assert.equal(getAgentRuntimeEnvValue("nodebox"), "nodebox");
    assert.equal(getAgentRuntimeEnvValue("linuxontab"), "linuxontab");
  });
});

describe("SerialBridge marker framing", () => {
  it("captures stdout between begin/end markers with exit code", async () => {
    const sent: string[] = [];
    const bridge = new SerialBridge({
      send: (text) => sent.push(text),
      timeoutMs: 5_000,
    });
    bridge.setReady(true);
    const pending = bridge.runShell("echo hello");
    const job = sent[0] || "";
    assert.match(job, /__WEBAGENT_LOT_BEGIN_lot1__/);
    const begin = "__WEBAGENT_LOT_BEGIN_lot1__";
    const end = "__WEBAGENT_LOT_END_lot1__:0";
    for (const ch of `\n${begin}\nhello\n${end}\n`) {
      bridge.onByte(ch.charCodeAt(0));
    }
    const result = await pending;
    assert.equal(result.stdout, "hello");
    assert.equal(result.exitCode, 0);
  });
});

describe("runtime constants", () => {
  it("detects linuxontab runtime kind", async () => {
    const prev = process.env.WEBAGENT_RUNTIME;
    process.env.WEBAGENT_RUNTIME = "linuxontab";
    const mod = await import("../src/agent/runtime/constants.ts");
    assert.equal(mod.isLinuxOnTabRuntime(), true);
    assert.equal(mod.isBrowserSandboxRuntime(), true);
    if (prev === undefined) delete process.env.WEBAGENT_RUNTIME;
    else process.env.WEBAGENT_RUNTIME = prev;
  });
});
