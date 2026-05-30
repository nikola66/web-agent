import { getSandboxRuntimeKind } from "./config";
import { nodeboxRuntime } from "./nodebox";
import { linuxOnTabRuntime } from "./linuxontab/boot";
import type { SandboxRuntime, SandboxRuntimeKind } from "./types";

export * from "./types";
export * from "./config";

const RUNTIMES: Record<SandboxRuntimeKind, SandboxRuntime> = {
  nodebox: nodeboxRuntime,
  linuxontab: linuxOnTabRuntime,
};

let activeRuntime: SandboxRuntime | null = null;

export function getActiveSandboxRuntimeKind(): SandboxRuntimeKind {
  return getSandboxRuntimeKind();
}

export function getSandboxRuntime(kind: SandboxRuntimeKind = getSandboxRuntimeKind()): SandboxRuntime {
  return RUNTIMES[kind];
}

export async function bootSandboxRuntime(
  kind: SandboxRuntimeKind = getSandboxRuntimeKind()
): Promise<SandboxRuntime> {
  const runtime = getSandboxRuntime(kind);
  await runtime.boot();
  activeRuntime = runtime;
  return runtime;
}

export function getActiveSandboxRuntime(): SandboxRuntime {
  return activeRuntime ?? getSandboxRuntime();
}

export async function teardownSandboxRuntime(): Promise<void> {
  if (activeRuntime) {
    await activeRuntime.teardown();
    activeRuntime = null;
    return;
  }
  await getSandboxRuntime().teardown();
}

/** Back-compat exports used across the app before runtime abstraction. */
export async function getNodebox() {
  const runtime = getSandboxRuntime("nodebox");
  await runtime.boot();
  return runtime.getActive();
}

export function getActiveNodebox() {
  return getSandboxRuntime("nodebox").getActive();
}

export async function teardownNodebox() {
  await getSandboxRuntime("nodebox").teardown();
}

export async function getNodeVersion(): Promise<string> {
  return getActiveSandboxRuntime().getNodeVersion();
}

export async function runNodeboxShellCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}
) {
  return getActiveSandboxRuntime().runShellCommand(command, args, options);
}

export async function spawnProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    terminal?: import("./types").SpawnPtySize;
  } = {}
) {
  return getActiveSandboxRuntime().spawnProcess(command, args, options);
}

export type { SandboxProcess as NodeboxProcess, SpawnPtySize } from "./types";

export { probeLinuxOnTabRuntime } from "./linuxontab/boot";
