import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SerialBridge } from "../src/runtimes/linuxontab/serial-bridge.ts";
import { GuestBootController } from "../src/runtimes/linuxontab/guest-boot.ts";
import { renderProgressBar } from "../src/runtimes/linuxontab/progress-bar.ts";
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

describe("guest boot controller", () => {
  it("auto-logs in on Alpine login prompt and detects root shell", () => {
    const sent: string[] = [];
    const boot = new GuestBootController((text) => sent.push(text));
    for (const ch of "localhost login: \n") boot.onSerialByte(ch.charCodeAt(0));
    assert.ok(sent.some((s) => s === "root\n"));
    for (const ch of "localhost:~# ") boot.onSerialByte(ch.charCodeAt(0));
    assert.equal(boot.isShellReady(), true);
  });

  it("does not treat typed echo command as guest-ready marker", async () => {
    const boot = new GuestBootController(() => {});
    for (const ch of "localhost:~# ") boot.onSerialByte(ch.charCodeAt(0));
    for (const ch of 'echo "[webagent] guest ready"\n') boot.onSerialByte(ch.charCodeAt(0));
    let setupDone = false;
    const setupPromise = boot.waitForSetupComplete(1000).then(() => {
      setupDone = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(setupDone, false);
    for (const ch of "[webagent] guest ready\n") boot.onSerialByte(ch.charCodeAt(0));
    await setupPromise;
    assert.equal(setupDone, true);
  });
});

describe("linuxontab progress bar", () => {
  it("renders demo-style ASCII blocks", () => {
    assert.equal(renderProgressBar(50, 4), "[\u2588\u2588\u2591\u2591]");
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
