import { buildGuestInitScript } from "./guest-init";

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")
    .replace(/\x1b[()][\x20-\x7e]/g, "")
    .replace(/\x1b[NO]/g, "")
    .replace(/\x1b[=>78cDEHMZ]/g, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, "");
}

const LOGIN_PROMPT_RE = /login:\s*$/i;
const SHELL_PROMPT_RE =
  /^(?!.*login:)(?!.*password:)(?:\x1b\[[0-9;]*m)*(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9_.-]+:[^\n]*#\s*$/i;
const SHELL_LINE_RE = /^(?!.*login:)(?!.*password:)[^\n]*:[^\n]*#\s*$/;
const SERIAL_FALLBACK_MARKER = "[webagent] init mount failed";
const GUEST_READY_LINE_RE = /(?:^|\n)\[webagent\] guest ready\r?(?:\n|$)/;

function guestReadyLineSeen(tail: string): boolean {
  return GUEST_READY_LINE_RE.test(stripAnsi(tail));
}

export type GuestBootProgress = (message: string, progressPct?: number) => void;
export type GuestInitDeployer = (script: string) => Promise<boolean>;

export class GuestBootController {
  private promptLine = "";
  private serialTail = "";
  private shellReady = false;
  private loginSent = false;
  private setupStarted = false;
  private setupDone = false;
  private serialFallbackStarted = false;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private netInitTimer: ReturnType<typeof setTimeout> | null = null;
  private shellWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private setupWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private shellDeadline = 0;
  private setupDeadline = 0;
  private freshBootTimer: ReturnType<typeof setTimeout> | null = null;
  private loginKickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private send: (text: string) => void,
    private onProgress: GuestBootProgress = (msg) => console.log("[linuxontab]", msg),
    private deployInit: GuestInitDeployer | null = null
  ) {}

  startFreshBootSafetyNet(): void {
    this.loginKickTimer = setTimeout(() => {
      if (this.shellReady || this.setupStarted) return;
      this.send("\n");
      if (!this.loginSent) {
        this.loginSent = true;
        this.onProgress("Sending root login (login kick)", 15);
        this.send("root\n");
      }
    }, 30_000);

    this.freshBootTimer = setTimeout(() => {
      if (this.setupDone || this.setupStarted) return;
      this.onProgress("Forcing guest setup (fresh-boot deadline)", 30);
      this.send("\n");
      if (!this.loginSent) {
        this.loginSent = true;
        this.send("root\n");
      }
      setTimeout(() => {
        if (this.setupDone || this.setupStarted) return;
        if (!this.shellReady) void this.markShellReady();
        else void this.runSetup();
      }, 400);
    }, 90_000);
  }

  onSerialByte(byte: number): void {
    const ch = String.fromCharCode(byte);
    if (ch === "\r" || ch === "\n") {
      this.promptLine = "";
    } else {
      this.promptLine = (this.promptLine + ch).slice(-256);
    }
    this.serialTail = (this.serialTail + ch).slice(-8192);
    this.noteSerialMarkers();
    this.detectLoginAndShellFromTail();

    const clean = stripAnsi(this.promptLine);
    if (!this.shellReady && !this.loginSent && LOGIN_PROMPT_RE.test(clean)) {
      this.loginSent = true;
      this.onProgress("Alpine login prompt detected — sending root", 12);
      this.send("root\n");
      return;
    }

    const cleanPrompt = clean.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    if (!this.shellReady && SHELL_PROMPT_RE.test(cleanPrompt)) {
      void this.markShellReady();
    }

    if (this.shellReady && !this.setupStarted) {
      this.scheduleNetInit();
    }
  }

  async waitForShell(timeoutMs: number): Promise<void> {
    if (this.shellReady) return;
    this.shellDeadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      this.shellWaiters.push({ resolve, reject });
      const timer = setInterval(() => {
        if (this.shellReady) {
          clearInterval(timer);
          return;
        }
        if (Date.now() > this.shellDeadline) {
          clearInterval(timer);
          this.rejectShellWaiters(
            new Error("LinuxOnTab timed out waiting for Alpine root shell")
          );
        }
      }, 500);
    });
  }

  async waitForSetupComplete(timeoutMs: number): Promise<void> {
    if (this.setupDone) return;
    this.setupDeadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      this.setupWaiters.push({ resolve, reject });
      const timer = setInterval(() => {
        if (this.setupDone) {
          clearInterval(timer);
          return;
        }
        if (Date.now() > this.setupDeadline) {
          clearInterval(timer);
          this.rejectSetupWaiters(
            new Error("LinuxOnTab timed out waiting for guest setup (network/apk)")
          );
        }
      }, 500);
    });
  }

  isShellReady(): boolean {
    return this.shellReady;
  }

  isLoginSent(): boolean {
    return this.loginSent;
  }

  dispose(): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    if (this.netInitTimer) clearTimeout(this.netInitTimer);
    if (this.freshBootTimer) clearTimeout(this.freshBootTimer);
    if (this.loginKickTimer) clearTimeout(this.loginKickTimer);
  }

  private detectLoginAndShellFromTail(): void {
    const lines = stripAnsi(this.serialTail).split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd();
      if (!this.loginSent && !this.shellReady && LOGIN_PROMPT_RE.test(line)) {
        this.loginSent = true;
        this.onProgress("Alpine login prompt detected — sending root", 12);
        this.send("root\n");
        return;
      }
      if (!this.shellReady && SHELL_LINE_RE.test(line)) {
        void this.markShellReady();
        return;
      }
    }
  }

  private noteSerialMarkers(): void {
    if (this.setupDone) return;
    if (this.serialTail.includes("[webagent] network ready")) {
      this.onProgress("Guest network ready", 45);
    }
    if (this.serialTail.includes("[webagent] dns-seed done")) {
      this.onProgress("Guest DNS seeded", 58);
    }
    if (this.serialTail.includes("[webagent] time synced")) {
      this.onProgress("Guest clock synced", 68);
    }
    if (this.serialTail.includes("[webagent] dns proxy ready")) {
      this.onProgress("Guest DNS proxy ready", 74);
    }
    if (this.serialTail.includes("[webagent] apk update done")) {
      this.onProgress("Guest apk index updated", 80);
    }
    if (this.serialTail.includes("[webagent] packages installed")) {
      this.onProgress("Guest packages installed", 92);
    }
    if (guestReadyLineSeen(this.serialTail)) this.markSetupDone();
    if (
      !this.serialFallbackStarted &&
      this.setupStarted &&
      !this.setupDone &&
      this.serialTail.includes(SERIAL_FALLBACK_MARKER)
    ) {
      void this.runSerialFallback("9p mount failed");
    }
  }

  private scheduleNetInit(): void {
    if (this.netInitTimer) clearTimeout(this.netInitTimer);
    this.netInitTimer = setTimeout(() => {
      this.netInitTimer = null;
      void this.runSetup();
    }, 900);
  }

  private async markShellReady(): Promise<void> {
    if (this.shellReady) return;
    this.shellReady = true;
    this.onProgress("Alpine root shell ready", 25);
    this.resolveShellWaiters();
    this.scheduleNetInit();
  }

  private async runSetup(): Promise<void> {
    if (this.setupStarted) return;
    this.setupStarted = true;
    this.onProgress("Running guest network + package setup…", 32);
    const script = buildGuestInitScript();
    if (this.deployInit && (await this.deployInit(script))) {
      this.onProgress("Guest init script deployed via 9p", 36);
      this.fallbackTimer = setTimeout(() => {
        if (
          !this.setupDone &&
          !this.serialFallbackStarted &&
          !this.serialTail.includes("[webagent] network ready")
        ) {
          void this.runSerialFallback("9p init timed out");
        }
      }, 120_000);
      return;
    }
    await this.runSerialFallback("9p deploy unavailable");
  }

  private async runSerialFallback(reason: string): Promise<void> {
    if (this.serialFallbackStarted || this.setupDone) return;
    this.serialFallbackStarted = true;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.onProgress(`Serial guest setup (${reason})`, 38);
    const script = buildGuestInitScript();
    const b64 = btoa(unescape(encodeURIComponent(script)));
    this.send(`printf '%s' '${b64}' | base64 -d | sh\n`);
    this.onProgress("Guest setup script sent — waiting for completion marker");
  }

  private markSetupDone(): void {
    if (this.setupDone) return;
    this.setupDone = true;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.onProgress("Guest setup complete", 100);
    this.resolveSetupWaiters();
  }

  private resolveShellWaiters(): void {
    for (const waiter of this.shellWaiters.splice(0)) waiter.resolve();
  }

  private rejectShellWaiters(err: Error): void {
    for (const waiter of this.shellWaiters.splice(0)) waiter.reject(err);
  }

  private resolveSetupWaiters(): void {
    for (const waiter of this.setupWaiters.splice(0)) waiter.resolve();
  }

  private rejectSetupWaiters(err: Error): void {
    for (const waiter of this.setupWaiters.splice(0)) waiter.reject(err);
  }
}
