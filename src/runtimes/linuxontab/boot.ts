import { SerialBridge } from "./serial-bridge";
import { GuestBootController } from "./guest-boot";
import { LinuxOnTabBootProgress } from "./progress-bar";
import type {
  SandboxFs,
  SandboxProcess,
  SandboxRuntime,
  SpawnPtySize,
} from "@/runtimes/types";

function readViteEnv(name: string): string {
  try {
    return String(import.meta.env?.[name] ?? "");
  } catch {
    return "";
  }
}

type V86Emulator = {
  serial0_send: (char: string) => void;
  keyboard_send_scancodes?: (codes: number[]) => void | Promise<void>;
  add_listener: (event: string, cb: (...args: unknown[]) => void) => void;
  remove_listener: (event: string, cb: (...args: unknown[]) => void) => void;
  destroy: () => void;
  run: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  create_file?: (path: string, data: Uint8Array) => Promise<void>;
  fs9p?: {
    SearchPath: (path: string) => { id: number; parentid: number; name: string } | null;
    Unlink: (parentid: number, name: string) => void;
    GetInode: (id: number) => { mode: number; mtime: number; ctime: number };
  };
};

declare global {
  interface Window {
    V86?: new (config: Record<string, unknown>) => V86Emulator;
  }
}

const BOOT_TIMEOUT_MS = 600_000;
const DEFAULT_ASSET_BASE = "https://linuxontab.com/shell/";
const DEFAULT_ISO = "alpine.iso";
const DEFAULT_RELAY = "wisps://linuxontab-net.fly.dev/wisp";

let emulator: V86Emulator | null = null;
let bridge: SerialBridge | null = null;
let booting: Promise<void> | null = null;
let bootReady = false;
let scriptLoaded = false;
let guestBoot: GuestBootController | null = null;
let bootProgress: LinuxOnTabBootProgress | null = null;

export function attachLinuxOnTabBootProgress(reporter: LinuxOnTabBootProgress | null): void {
  bootProgress = reporter;
}

function tapEnter(): void {
  try {
    emulator?.keyboard_send_scancodes?.([0x1c, 0x9c]);
  } catch {
    /* keyboard optional */
  }
}

function assetBase(): string {
  const raw = String(readViteEnv("VITE_LINUXONTAB_ASSET_BASE") || DEFAULT_ASSET_BASE).trim();
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function assetUrl(name: string): string {
  return `${assetBase()}${name}`;
}

async function loadV86Script(): Promise<void> {
  if (scriptLoaded && window.V86) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-webagent-v86="1"]');
    if (existing && window.V86) {
      scriptLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = assetUrl("libv86.js");
    script.async = true;
    script.dataset.webagentV86 = "1";
    script.onload = () => {
      scriptLoaded = true;
      if (!window.V86) reject(new Error("libv86.js loaded but V86 constructor missing"));
      else resolve();
    };
    script.onerror = () =>
      reject(
        new Error(
          `Failed to load v86 from ${script.src}. Set VITE_LINUXONTAB_ASSET_BASE or check network access.`
        )
      );
    document.head.appendChild(script);
  });
}

function sendSerial(text: string): void {
  if (!emulator) throw new Error("LinuxOnTab emulator not booted");
  for (let i = 0; i < text.length; i++) emulator.serial0_send(text[i]!);
}

async function deployGuestInitScript(script: string): Promise<boolean> {
  const emu = emulator;
  const fs = emu?.fs9p;
  if (!emu?.create_file || !fs) return false;
  const fsPath = "/.webagent-init.sh";
  try {
    try {
      const existing = fs.SearchPath(fsPath);
      if (existing && existing.id !== -1 && existing.parentid !== -1) {
        fs.Unlink(existing.parentid, existing.name);
      }
    } catch {
      /* no prior file */
    }
    await emu.create_file(fsPath, new TextEncoder().encode(script));
    try {
      const sp = fs.SearchPath(fsPath);
      if (sp && sp.id !== -1) {
        const inode = fs.GetInode(sp.id);
        inode.mode = (inode.mode & ~0o777) | 0o755;
        const now = Math.floor(Date.now() / 1000);
        inode.mtime = now;
        inode.ctime = now;
      }
    } catch {
      /* chmod best-effort */
    }
    sendSerial(
      "mkdir -p /tmp/.lothost 2>/dev/null; " +
        "mount -t 9p -o trans=virtio,version=9p2000.L,msize=8192,access=any,cache=none host9p /tmp/.lothost 2>/dev/null; " +
        "sh /tmp/.lothost/.webagent-init.sh\n"
    );
    return true;
  } catch (err) {
    console.warn("[linuxontab] 9p init deploy failed", err);
    return false;
  }
}

async function waitForGuestReady(timeoutMs = BOOT_TIMEOUT_MS): Promise<void> {
  if (!guestBoot) throw new Error("Guest boot controller not initialized");
  await guestBoot.waitForShell(Math.min(timeoutMs, 300_000));
  await guestBoot.waitForSetupComplete(Math.min(timeoutMs, 780_000));
  bridge!.setReady(true);
  const probe = await getBridge().runShell("echo __WEBAGENT_LOT_LOGIN_OK__", { timeoutMs: 120_000 });
  if (!probe.stdout.includes("__WEBAGENT_LOT_LOGIN_OK__") || probe.exitCode !== 0) {
    throw new Error("LinuxOnTab shell probe failed after guest setup");
  }
  bootProgress?.completeGuestSetup();
}

async function ensureGuestPackages(): Promise<void> {
  const bridgeRef = getBridge();
  const nodeProbe = await bridgeRef.runCommand("node", ["-v"], { timeoutMs: 10_000 });
  const pythonProbe = await bridgeRef.runCommand("python3", ["--version"], { timeoutMs: 10_000 });
  if (nodeProbe.exitCode === 0 && pythonProbe.exitCode === 0) return;
  throw new Error("LinuxOnTab guest is missing Node.js or Python after setup.");
}

function getBridge(): SerialBridge {
  if (!bridge) throw new Error("LinuxOnTab serial bridge not initialized");
  return bridge;
}

function waitForEmulatorEvent(event: string, timeoutMs: number): Promise<void> {
  const emu = emulator;
  if (!emu) return Promise.reject(new Error("LinuxOnTab emulator not initialized"));
  return new Promise((resolve, reject) => {
    const handler = () => {
      clearTimeout(timer);
      emu.remove_listener(event, handler);
      resolve();
    };
    const timer = setTimeout(() => {
      emu.remove_listener(event, handler);
      reject(new Error(`LinuxOnTab v86 '${event}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    emu.add_listener(event, handler);
  });
}

async function bootEmulator(): Promise<void> {
  const iso = String(readViteEnv("VITE_LINUXONTAB_ISO") || DEFAULT_ISO).trim() || DEFAULT_ISO;
  bootProgress?.header(`${iso} (v86 + network)`);
  bootProgress?.beginVmLoad(50 * 1024 * 1024);

  await loadV86Script();
  if (emulator) {
    bootProgress?.completeVmLoad();
    bootProgress?.completeGuestSetup();
    return;
  }

  bridge = new SerialBridge({ send: sendSerial, timeoutMs: 120_000 });
  guestBoot = new GuestBootController(sendSerial, (msg, pct) => {
    console.log("[linuxontab]", msg);
    if (pct !== undefined) bootProgress?.setGuestPct(pct);
    bootProgress?.log(msg);
  }, deployGuestInitScript);

  const memMb = Number.parseInt(String(readViteEnv("VITE_LINUXONTAB_MEM_MB") || "2048"), 10) || 2048;
  const relay = String(readViteEnv("VITE_LINUXONTAB_RELAY_URL") || DEFAULT_RELAY).trim() || DEFAULT_RELAY;

  let downloadError: unknown = null;
  emulator = new window.V86!({
    wasm_path: assetUrl("v86.wasm"),
    bios: { url: assetUrl("seabios.bin") },
    vga_bios: { url: assetUrl("vgabios.bin") },
    cdrom: { url: assetUrl(iso) },
    memory_size: memMb * 1024 * 1024,
    vga_memory_size: 4 * 1024 * 1024,
    autostart: true,
    disable_mouse: true,
    filesystem: {},
    net_device: {
      type: "ne2k",
      relay_url: relay,
      dns_method: "doh",
      doh_server: "relay.linuxontab.com",
      cors_proxy: "https://relay.linuxontab.com/cors?url=",
    },
  });

  emulator.add_listener("download-error", (info) => {
    downloadError = info;
    console.error("[linuxontab] v86 asset download failed", info);
  });

  emulator.add_listener("serial0-output-byte", (byte) => {
    guestBoot?.onSerialByte(Number(byte));
    bridge?.onByte(Number(byte));
  });

  await waitForEmulatorEvent("emulator-ready", 300_000);
  bootProgress?.completeVmLoad();
  bootProgress?.beginGuestSetup();
  guestBoot.startFreshBootSafetyNet();
  if (downloadError) {
    throw new Error(
      `LinuxOnTab failed to download v86 assets: ${JSON.stringify(downloadError)}`
    );
  }

  const isolinuxAutopilot = setInterval(() => {
    if (guestBoot?.isShellReady() || guestBoot?.isLoginSent()) {
      clearInterval(isolinuxAutopilot);
      return;
    }
    tapEnter();
  }, 1500);
  setTimeout(() => clearInterval(isolinuxAutopilot), 180_000);

  await waitForGuestReady();
  bootReady = true;
  await ensureGuestPackages();
}

class LinuxOnTabFs implements SandboxFs {
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const flag = options?.recursive ? "-p" : "";
    await getBridge().runShell(`mkdir ${flag} ${shellQuote(path)}`.trim());
  }

  async writeFile(path: string, contents: string | Uint8Array): Promise<void> {
    const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
    const b64 = bytesToBase64(bytes);
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await this.mkdir(dir, { recursive: true });
    await getBridge().runShell(
      `printf '%s' '${b64}' | base64 -d > ${shellQuote(path)}`
    );
  }

  async readFile(path: string): Promise<Uint8Array> {
    const result = await getBridge().runShell(`base64 ${shellQuote(path)} | tr -d '\\n'`);
    if (result.exitCode !== 0) throw new Error(`readFile failed: ${path}`);
    return base64ToBytes(result.stdout.trim());
  }

  async readdir(path: string): Promise<string[]> {
    const result = await getBridge().runShell(`ls -1 ${shellQuote(path)} 2>/dev/null`);
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const flags = [options?.recursive ? "-r" : "", options?.force ? "-f" : ""]
      .filter(Boolean)
      .join(" ");
    await getBridge().runShell(`rm ${flags} ${shellQuote(path)}`.trim());
  }

  async stat(path: string): Promise<{ type: "file" | "dir" }> {
    const result = await getBridge().runShell(
      `if [ -d ${shellQuote(path)} ]; then echo dir; elif [ -f ${shellQuote(path)} ]; then echo file; else echo missing; fi`
    );
    if (result.stdout.trim() === "dir") return { type: "dir" };
    if (result.stdout.trim() === "file") return { type: "file" };
    throw new Error(`stat failed: ${path}`);
  }
}

class LinuxOnTabProcess implements SandboxProcess {
  exit: Promise<number>;
  private handler: ((data: string) => void) | null = null;
  private buffer: string[] = [];
  private offset = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private outPath: string;
  private inPath: string;
  private killed = false;

  constructor(
    private readonly bridgeRef: SerialBridge,
    ipcDir: string,
    exitPromise: Promise<number>
  ) {
    this.outPath = `${ipcDir}/out`;
    this.inPath = `${ipcDir}/in`;
    this.exit = exitPromise;
    this.pollTimer = setInterval(() => {
      void this.pollOutput();
    }, 40);
  }

  onData(cb: (data: string) => void): void {
    this.handler = cb;
    for (const chunk of this.buffer) cb(chunk);
    this.buffer = [];
  }

  async write(data: string): Promise<void> {
    const escaped = data.replace(/'/g, `'\\''`);
    await this.bridgeRef.runShell(`printf '%s' '${escaped}' >> ${shellQuote(this.inPath)}`, {
      timeoutMs: 30_000,
    });
  }

  async kill(): Promise<void> {
    this.killed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.bridgeRef.runShell(`pkill -f '${this.outPath.replace(/'/g, `'\\''`)}' 2>/dev/null || true`);
  }

  resize(_dims: SpawnPtySize): void {}

  private emit(chunk: string): void {
    if (!chunk) return;
    if (this.handler) this.handler(chunk);
    else this.buffer.push(chunk);
  }

  private async pollOutput(): Promise<void> {
    if (this.killed) return;
    const script = [
      `if [ -f ${shellQuote(this.outPath)} ]; then`,
      `  tail -c +$(( ${this.offset} + 1 )) ${shellQuote(this.outPath)} | head -c 65536 | base64 | tr -d '\\n';`,
      `fi`,
    ].join(" ");
    try {
      const result = await this.bridgeRef.runShell(script, { timeoutMs: 15_000 });
      if (result.exitCode !== 0 || !result.stdout) return;
      const chunkBytes = base64ToBytes(result.stdout);
      if (!chunkBytes.length) return;
      this.offset += chunkBytes.length;
      this.emit(new TextDecoder().decode(chunkBytes));
    } catch {
      /* polling errors are non-fatal */
    }
  }
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export const linuxOnTabRuntime: SandboxRuntime = {
  kind: "linuxontab",
  async boot() {
    if (bootReady && emulator) return;
    if (booting) return booting;
    booting = bootEmulator()
      .catch((err) => {
        booting = null;
        throw err;
      })
      .then(() => {
        booting = null;
      });
    return booting;
  },
  async teardown() {
    bootReady = false;
    guestBoot?.dispose();
    guestBoot = null;
    bridge = null;
    if (emulator) {
      try {
        emulator.stop();
      } catch {
        /* ignore */
      }
      emulator = null;
    }
  },
  getActive() {
    return emulator;
  },
  async getFs() {
    await this.boot();
    return new LinuxOnTabFs();
  },
  async getNodeVersion() {
    await this.boot();
    const result = await getBridge().runCommand("node", ["-v"]);
    return result.stdout.trim().replace(/^v/, "");
  },
  async runShellCommand(command, args, options) {
    await this.boot();
    const result = await getBridge().runCommand(command, args, options);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  },
  async spawnProcess(command, args, options = {}) {
    await this.boot();
    const bridgeRef = getBridge();
    const cwd = options.cwd || "/root";
    const ipcDir = `${cwd}/.webagent/ipc`;
    const envEntries = Object.entries(options.env || {});
    const envPrefix = envEntries.length
      ? envEntries.map(([k, v]) => `${k}=${shellQuote(v)}`).join(" ") + " "
      : "";
    const cmdLine = [shellQuote(command), ...args.map(shellQuote)].join(" ");
    const setupScript = [
      `cd ${shellQuote(cwd)}`,
      `mkdir -p ${shellQuote(ipcDir)}`,
      `rm -f ${shellQuote(`${ipcDir}/in`)} ${shellQuote(`${ipcDir}/out`)} ${shellQuote(`${ipcDir}/agent.pid`)}`,
      `mkfifo ${shellQuote(`${ipcDir}/in`)} ${shellQuote(`${ipcDir}/out`)}`,
      `(${envPrefix}${cmdLine} < ${shellQuote(`${ipcDir}/in`)} > ${shellQuote(`${ipcDir}/out`)} 2>&1 &)`,
      `echo $! > ${shellQuote(`${ipcDir}/agent.pid`)}`,
    ].join(" && ");
    await bridgeRef.runShell(setupScript, { timeoutMs: 60_000 });
    const exitPromise = bridgeRef
      .runShell(
        `while kill -0 $(cat ${shellQuote(`${ipcDir}/agent.pid`)} 2>/dev/null) 2>/dev/null; do sleep 1; done; wait $(cat ${shellQuote(`${ipcDir}/agent.pid`)} 2>/dev/null) 2>/dev/null; echo $?`,
        { timeoutMs: 24 * 60 * 60 * 1000 }
      )
      .then((result) => Number.parseInt(result.stdout.trim().split("\n").pop() || "0", 10))
      .catch(() => 1);
    return new LinuxOnTabProcess(bridgeRef, ipcDir, exitPromise);
  },
};

export async function probeLinuxOnTabRuntime(): Promise<{
  nodeVersion: string;
  pythonVersion: string;
}> {
  await linuxOnTabRuntime.boot();
  const bridgeRef = getBridge();
  const node = await bridgeRef.runCommand("node", ["-v"]);
  const python = await bridgeRef.runCommand("python3", ["--version"]);
  return {
    nodeVersion: node.stdout.trim(),
    pythonVersion: python.stdout.trim(),
  };
}
