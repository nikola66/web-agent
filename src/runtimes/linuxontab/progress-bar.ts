export function renderProgressBar(pct: number, width = 20): string {
  const w = width || 20;
  const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  return "[" + "\u2588".repeat(filled) + "\u2591".repeat(w - filled) + "]";
}

export type LinuxOnTabProgressWriter = (data: string) => void;

export class LinuxOnTabBootProgress {
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase: "idle" | "loading" | "guest" = "idle";
  private label = "loading";
  private t0 = 0;
  private estMs = 8000;
  private guestFloorPct = 0;
  private readonly barWidth = 24;

  constructor(private write: LinuxOnTabProgressWriter) {}

  log(message: string): void {
    this.write(`\x1b[90m  ${message}\x1b[0m\n`);
  }

  header(isoLabel: string): void {
    this.write(`\x1b[36m[linuxontab]\x1b[0m booting ${isoLabel}\n`);
  }

  beginVmLoad(totalBytes = 50 * 1024 * 1024): void {
    this.stopTimer();
    this.phase = "loading";
    this.label = "loading";
    this.guestFloorPct = 0;
    this.estMs = Math.max(8000, (totalBytes / (7 * 1024 * 1024)) * 1000);
    this.t0 = Date.now();
    this.draw(0);
    this.timer = setInterval(() => {
      if (this.phase !== "loading") return;
      this.draw(Math.min(0.95, (Date.now() - this.t0) / this.estMs));
    }, 150);
  }

  completeVmLoad(): void {
    if (this.phase !== "loading") return;
    this.draw(1);
    this.stopTimer();
    this.write("\r\n");
    this.phase = "guest";
  }

  beginGuestSetup(estimateMs = 240_000): void {
    this.phase = "guest";
    this.label = "booting";
    this.guestFloorPct = 0;
    this.estMs = estimateMs;
    this.t0 = Date.now();
    this.draw(this.guestProgressFrac());
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.phase !== "guest") return;
      this.draw(this.guestProgressFrac());
    }, 150);
  }

  setGuestPct(pct: number, label?: string): void {
    if (this.phase !== "guest") this.beginGuestSetup();
    if (label) this.label = label;
    this.guestFloorPct = Math.max(this.guestFloorPct, Math.max(0, Math.min(100, Math.round(pct))));
    this.draw(this.guestProgressFrac());
  }

  completeGuestSetup(): void {
    if (this.phase === "idle") return;
    this.guestFloorPct = 100;
    this.label = "ready";
    this.draw(1);
    this.stopTimer();
    this.write("\r\n");
    this.phase = "idle";
  }

  dispose(): void {
    this.stopTimer();
    this.phase = "idle";
    this.guestFloorPct = 0;
  }

  private guestProgressFrac(): number {
    const timed = 0.05 + ((Date.now() - this.t0) / this.estMs) * 0.9;
    return Math.min(0.95, Math.max(this.guestFloorPct / 100, timed));
  }

  private draw(frac: number): void {
    const pct = Math.min(100, Math.round(Math.max(0, frac) * 100));
    const filled = Math.round(Math.min(1, Math.max(0, frac)) * this.barWidth);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(this.barWidth - filled);
    this.write(
      `\r\x1b[2K\x1b[36m[linuxontab]\x1b[0m ${this.label}  [${bar}] ${String(pct).padStart(3)}%  `
    );
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
