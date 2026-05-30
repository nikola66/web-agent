export type SandboxRuntimeKind = "nodebox" | "linuxontab";

export type OutputHandler = (data: string) => void;
export type SpawnPtySize = { cols: number; rows: number };

export interface SandboxProcess {
  exit: Promise<number>;
  onData(cb: (data: string) => void): void;
  write(data: string): Promise<void>;
  kill(): Promise<void>;
  resize(dims: SpawnPtySize): void;
}

export interface SandboxFsStat {
  type: "file" | "dir";
}

export interface SandboxFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, contents: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<SandboxFsStat>;
}

export interface RunShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface RunShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpawnProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  terminal?: SpawnPtySize;
}

export interface SandboxRuntime {
  readonly kind: SandboxRuntimeKind;
  boot(): Promise<void>;
  teardown(): Promise<void>;
  getActive(): unknown;
  getFs(): Promise<SandboxFs>;
  getNodeVersion(): Promise<string>;
  runShellCommand(
    command: string,
    args: string[],
    options?: RunShellOptions
  ): Promise<RunShellResult>;
  spawnProcess(
    command: string,
    args: string[],
    options?: SpawnProcessOptions
  ): Promise<SandboxProcess>;
}
