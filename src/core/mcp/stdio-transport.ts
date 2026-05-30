import type { SandboxProcess } from "@/runtimes/types";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

type ReadBufferState = Buffer | undefined;

function deserializeMessage(line: string): JSONRPCMessage {
  return JSON.parse(line) as JSONRPCMessage;
}

function serializeMessage(message: JSONRPCMessage): string {
  return `${JSON.stringify(message)}\n`;
}

class ReadBuffer {
  private _buffer: ReadBufferState;

  append(chunk: Buffer | string) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this._buffer = this._buffer ? Buffer.concat([this._buffer, buf]) : buf;
  }

  readMessage(): JSONRPCMessage | null {
    if (!this._buffer) return null;
    const index = this._buffer.indexOf("\n");
    if (index === -1) return null;
    const line = this._buffer.toString("utf8", 0, index).replace(/\r$/, "");
    this._buffer = this._buffer.subarray(index + 1);
    if (!line.trim()) return this.readMessage();
    return deserializeMessage(line);
  }

  clear() {
    this._buffer = undefined;
  }
}

export type NodeboxStdioParams = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  spawn: (
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> }
  ) => Promise<SandboxProcess>;
};

export class NodeboxStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private _process: SandboxProcess | null = null;
  private _readBuffer = new ReadBuffer();
  private _closed = false;

  constructor(private readonly _params: NodeboxStdioParams) {}

  async start(): Promise<void> {
    if (this._process) return;
    this._closed = false;
    const proc = await this._params.spawn(this._params.command, this._params.args, {
      ...(this._params.cwd ? { cwd: this._params.cwd } : {}),
      ...(this._params.env ? { env: this._params.env } : {}),
    });
    this._process = proc;
    proc.onData((data) => {
      try {
        this._readBuffer.append(data);
        for (;;) {
          const msg = this._readBuffer.readMessage();
          if (!msg) break;
          this.onmessage?.(msg);
        }
      } catch (err) {
        this.onerror?.(err instanceof Error ? err : new Error(String(err)));
      }
    });
    void proc.exit.then((code) => {
      if (this._closed) return;
      this._closed = true;
      this.onerror?.(new Error(`MCP stdio process exited (${code})`));
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._process) throw new Error("Nodebox stdio transport not started");
    await this._process.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this._closed = true;
    this._readBuffer.clear();
    if (this._process) {
      try {
        await this._process.kill();
      } catch {
        /* ignore */
      }
      this._process = null;
    }
    this.onclose?.();
  }
}

export function buildSafeStdioEnv(userEnv: Record<string, string> = {}): Record<string, string> {
  const safeKeys = new Set(["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR"]);
  const env: Record<string, string> = { PATH: "/usr/local/bin:/usr/bin:/bin" };
  if (typeof process !== "undefined" && process.env) {
    for (const [key, value] of Object.entries(process.env)) {
      if ((safeKeys.has(key) || key.startsWith("XDG_")) && value != null) {
        env[key] = String(value);
      }
    }
  }
  return { ...env, ...userEnv };
}
