/**
 * Serial command bridge for LinuxOnTab / v86 guests.
 * Runs shell jobs framed by unique begin/end markers on serial0 output.
 */

export interface SerialJobResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SerialBridgeOptions {
  send: (text: string) => void;
  timeoutMs?: number;
}

type PendingJob = {
  id: string;
  begin: string;
  end: string;
  beginRe: RegExp;
  endRe: RegExp;
  started: boolean;
  output: string;
  resolve: (result: SerialJobResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let jobCounter = 0;

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

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export class SerialBridge {
  private sendFn: (text: string) => void;
  private defaultTimeoutMs: number;
  private queue: Array<() => void> = [];
  private busy = false;
  private ready = false;
  private current: PendingJob | null = null;
  private buf = "";
  private readonly echoMaxLen = 512 * 1024;

  constructor(options: SerialBridgeOptions) {
    this.sendFn = options.send;
    this.defaultTimeoutMs = options.timeoutMs ?? 120_000;
  }

  setReady(yes: boolean): void {
    this.ready = yes;
    if (this.ready && !this.busy && this.queue.length) this.dequeue();
  }

  onByte(byte: number): void {
    if (!this.current) return;
    this.buf += String.fromCharCode(byte);
    if (this.buf.length > this.echoMaxLen) {
      this.buf = this.buf.slice(-this.echoMaxLen);
    }
    const job = this.current;
    const cleanBuf = stripAnsi(this.buf);
    if (!job.started) {
      const match = cleanBuf.match(job.beginRe);
      if (!match) return;
      job.started = true;
      this.buf = cleanBuf.slice(match.index! + match[0].length);
      job.output = "";
    }
    const clean = stripAnsi(this.buf);
    const endMatch = clean.match(job.endRe);
    if (!endMatch) return;
    job.output += clean.slice(0, endMatch.index);
    const exitCode = Number.parseInt(endMatch[1] || "127", 10);
    this.buf = clean.slice(endMatch.index! + endMatch[0].length);
    this.finishCurrent(job, exitCode);
  }

  runShell(
    script: string,
    options: { timeoutMs?: number } = {}
  ): Promise<SerialJobResult> {
    return new Promise((resolve, reject) => {
      const id = `lot${++jobCounter}`;
      const begin = `__WEBAGENT_LOT_BEGIN_${id}__`;
      const end = `__WEBAGENT_LOT_END_${id}__`;
      const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
      const timer = setTimeout(() => {
        if (this.current?.id !== id) return;
        this.current = null;
        this.busy = false;
        reject(new Error(`SerialBridge timed out after ${timeoutMs}ms`));
        this.dequeue();
      }, timeoutMs);
      const job: PendingJob = {
        id,
        begin,
        end,
        beginRe: new RegExp(`\\n${begin}\\r?\\n`),
        endRe: new RegExp(`\\n${end}:(\\d+)\\r?\\n`),
        started: false,
        output: "",
        resolve,
        reject,
        timer,
      };
      this.queue.push(() => {
        this.busy = true;
        this.current = job;
        this.buf = "";
        const wrapped = [
          `printf '\\n${begin}\\n'`,
          `{ ${script}; ec=$?; }`,
          `printf '\\n${end}:%s\\n' "$ec"`,
        ].join("; ");
        this.send(`${wrapped}\n`);
      });
      if (this.ready && !this.busy) this.dequeue();
    });
  }

  runCommand(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}
  ): Promise<SerialJobResult> {
    const parts = [shellQuote(command), ...args.map(shellQuote)];
    const envPrefix =
      options.env && Object.keys(options.env).length
        ? `${Object.entries(options.env)
            .map(([key, value]) => `${key}=${shellQuote(value)}`)
            .join(" ")} `
        : "";
    const cdPrefix = options.cwd ? `cd ${shellQuote(options.cwd)} && ` : "";
    const script = `${cdPrefix}${envPrefix}${parts.join(" ")}`;
    return this.runShell(script, { timeoutMs: options.timeoutMs });
  }

  private finishCurrent(job: PendingJob, exitCode: number): void {
    clearTimeout(job.timer);
    this.current = null;
    this.busy = false;
    job.resolve({
      stdout: job.output.trimEnd(),
      stderr: "",
      exitCode: Number.isFinite(exitCode) ? exitCode : 127,
    });
    this.dequeue();
  }

  private dequeue(): void {
    if (!this.ready || this.busy || !this.queue.length) return;
    const next = this.queue.shift();
    next?.();
  }

  private send(text: string): void {
    this.sendFn(text);
  }
}
