/**
 * Nodebox-backed runtime — replaces WebContainer.
 * Fetch calls from Node.js code inside Nodebox use the browser's native
 * network stack (page origin), so same-origin proxies work correctly.
 */

import { Nodebox, type ShellProcess } from "@codesandbox/nodebox";

let instance: Nodebox | null = null;
let booting: Promise<Nodebox> | null = null;
let nodeboxIframe: HTMLIFrameElement | null = null;

export type OutputHandler = (data: string) => void;
export type SpawnPtySize = { cols: number; rows: number };

function createNodeboxIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  // Must NOT use display:none — browsers block Service Workers in hidden iframes.
  // position:fixed off-screen keeps it functional but invisible.
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;";
  document.body.appendChild(iframe);
  return iframe;
}

function normalizeBootError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const isOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  const looksBlockedByClient =
    lower.includes("err_blocked_by_client") ||
    lower.includes("blocked by client");
  const looksNetworkRelated =
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("err_internet_disconnected") ||
    lower.includes("err_timed_out");

  if (isOffline || looksNetworkRelated || looksBlockedByClient) {
    return new Error(
      "Nodebox runtime download failed. Check your network connection and any " +
        "content blockers/firewalls that may block CodeSandbox domains, then retry launch."
    );
  }

  return new Error(
    `Nodebox boot failed: ${message}. ` +
      "If this is the first launch, keep the tab open while runtime assets download."
  );
}

/** Boot (or return) the shared Nodebox instance */
export async function getNodebox(): Promise<Nodebox> {
  if (instance) return instance;
  if (booting) return booting;

  nodeboxIframe = createNodeboxIframe();
  const emulator = new Nodebox({ iframe: nodeboxIframe });

  booting = emulator
    .connect()
    .then(() => {
      instance = emulator;
      booting = null;
      return emulator;
    })
    .catch((err) => {
      booting = null;
      nodeboxIframe?.remove();
      nodeboxIframe = null;
      throw normalizeBootError(err);
    });

  return booting;
}

/** Return the active Nodebox instance without booting a new one. */
export function getActiveNodebox(): Nodebox | null {
  return instance;
}

/** Teardown the Nodebox instance */
export async function teardownNodebox(): Promise<void> {
  booting = null;
  instance = null;
  if (nodeboxIframe) {
    nodeboxIframe.remove();
    nodeboxIframe = null;
  }
}

/** Check Node.js version inside Nodebox */
export async function getNodeVersion(): Promise<string> {
  const emulator = await getNodebox();
  const shell = emulator.shell.create();
  let version = "";
  shell.stdout.on("data", (data) => {
    version += data;
  });

  let exitResolve!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });
  await shell.on("exit", () => exitResolve());

  await shell.runCommand("node", ["--version"]);
  await exitPromise;
  return version.trim().replace(/^v/, "");
}

/** Run npm install in a given working directory */
export async function npmInstall(
  cwd: string,
  onOutput: OutputHandler
): Promise<number> {
  const emulator = await getNodebox();
  const shell = emulator.shell.create();
  shell.stdout.on("data", (data) => onOutput(data));
  shell.stderr.on("data", (data) => onOutput(data));

  let exitResolve!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });
  await shell.on("exit", (code) => exitResolve(code ?? 0));

  await shell.runCommand("npm", ["install"], { cwd });
  return exitPromise;
}

/** Directory used for local package installs */
export const NPM_INSTALL_DIR = "/runner";

export async function npmInstallGlobal(
  pkg: string,
  onOutput: OutputHandler,
  extraFiles: Record<string, string> = {}
): Promise<number> {
  const emulator = await getNodebox();

  await emulator.fs.mkdir(NPM_INSTALL_DIR, { recursive: true });
  await emulator.fs.writeFile(
    `${NPM_INSTALL_DIR}/package.json`,
    JSON.stringify({ name: "runner", private: true })
  );

  if (Object.keys(extraFiles).length > 0) {
    await emulator.fs.mkdir("/tools", { recursive: true });
    for (const [name, contents] of Object.entries(extraFiles)) {
      await emulator.fs.writeFile(`/tools/${name}`, contents);
    }
  }

  const shell = emulator.shell.create();
  shell.stdout.on("data", (data) => onOutput(data));
  shell.stderr.on("data", (data) => onOutput(data));

  let exitResolve!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });
  await shell.on("exit", (code) => exitResolve(code ?? 0));

  await shell.runCommand("npm", ["install", pkg], { cwd: NPM_INSTALL_DIR });
  return exitPromise;
}

const NODEBOX_RUN_SHELL_OUTPUT_CAP = 512 * 1024;

/**
 * Run a command via Nodebox shell API (same path as agent bootstrap).
 * Use this instead of `child_process.spawn` inside the sandbox — Nodebox's spawn polyfill can throw (e.g. `.replace` on non-strings).
 */
export async function runNodeboxShellCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const emulator = await getNodebox();
  const shell = emulator.shell.create();
  let stdout = "";
  let stderr = "";
  shell.stdout.on("data", (data: string) => {
    if (stdout.length < NODEBOX_RUN_SHELL_OUTPUT_CAP) stdout += data;
  });
  shell.stderr.on("data", (data: string) => {
    if (stderr.length < NODEBOX_RUN_SHELL_OUTPUT_CAP) stderr += data;
  });

  let exitResolve!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });
  await shell.on("exit", (code) => exitResolve(code ?? 0));

  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 120_000;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    const shellOpts: { cwd?: string; env?: Record<string, string> } = {};
    if (options.cwd !== undefined && String(options.cwd).trim() !== "") {
      shellOpts.cwd = options.cwd;
    }
    if (options.env && typeof options.env === "object") {
      shellOpts.env = options.env;
    }
    await shell.runCommand(command, args, shellOpts);
    const exitCode = await exitPromise;
    return { stdout, stderr, exitCode };
  };

  try {
    const result = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`run_shell timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return result;
  } catch (e) {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    try {
      await shell.kill?.();
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * Wraps a Nodebox ShellProcess with a stable interface.
 * Buffers stdout/stderr from the moment of creation so data emitted before
 * onData() is registered is not lost (important for fast-crashing processes).
 * Nodebox does not support PTY resize — resize() is a no-op.
 */
export class NodeboxProcess {
  private shell: ShellProcess;
  exit: Promise<number>;
  private _handler: ((data: string) => void) | null = null;
  private _buffer: string[] = [];

  constructor(shell: ShellProcess, exitPromise: Promise<number>) {
    this.shell = shell;
    this.exit = exitPromise;
    const route = (data: string) => {
      if (this._handler) this._handler(data);
      else this._buffer.push(data);
    };
    shell.stdout.on("data", route);
    shell.stderr.on("data", route);
  }

  onData(cb: (data: string) => void): void {
    this._handler = cb;
    for (const chunk of this._buffer) cb(chunk);
    this._buffer = [];
  }

  async write(data: string): Promise<void> {
    await this.shell.stdin.write(data);
  }

  async kill(): Promise<void> {
    await this.shell.kill();
  }

  /** No-op: Nodebox does not support PTY resize. */
  resize(_dims: SpawnPtySize): void {}
}

/** Spawn a persistent process and return it */
export async function spawnProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    terminal?: SpawnPtySize;
  } = {}
): Promise<NodeboxProcess> {
  const emulator = await getNodebox();
  const shell = emulator.shell.create();

  // Register exit listener before starting to avoid missing early exit
  let exitResolve!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });
  await shell.on("exit", (code) => exitResolve(code ?? 0));

  await shell.runCommand(command, args, {
    cwd: options.cwd,
    env: options.env,
  });

  return new NodeboxProcess(shell, exitPromise);
}
