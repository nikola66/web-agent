import { getActiveSandboxRuntime } from "./index";
import type { SandboxFs } from "./types";

export async function getSandboxFs(): Promise<SandboxFs> {
  return getActiveSandboxRuntime().getFs();
}

export async function getLiveSandboxFs(): Promise<SandboxFs | null> {
  try {
    const runtime = getActiveSandboxRuntime();
    if (!runtime.getActive()) return null;
    return runtime.getFs();
  } catch {
    return null;
  }
}

export async function readSandboxFileUtf8(path: string): Promise<string> {
  const fs = await getSandboxFs();
  const data = await fs.readFile(path);
  return new TextDecoder().decode(data);
}
