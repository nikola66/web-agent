import type { SandboxRuntimeKind } from "./types";

const RUNTIME_VALUES: SandboxRuntimeKind[] = ["nodebox", "linuxontab"];

function normalizeRuntimeKind(raw: string): SandboxRuntimeKind | null {
  const value = String(raw || "").trim().toLowerCase();
  return RUNTIME_VALUES.includes(value as SandboxRuntimeKind)
    ? (value as SandboxRuntimeKind)
    : null;
}

function readViteEnv(name: string): string {
  try {
    return String(import.meta.env?.[name] ?? "");
  } catch {
    return "";
  }
}

/** Host-side runtime selector (Vite env or URL ?runtime=linuxontab). Default: nodebox. */
export function getSandboxRuntimeKind(): SandboxRuntimeKind {
  if (typeof window !== "undefined") {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("runtime");
      const urlKind = normalizeRuntimeKind(fromUrl || "");
      if (urlKind) return urlKind;
    } catch {
      /* ignore */
    }
  }
  const fromEnv = normalizeRuntimeKind(readViteEnv("VITE_WEBAGENT_RUNTIME"));
  return fromEnv || "nodebox";
}

/** Env value injected into the embedded agent process. */
export function getAgentRuntimeEnvValue(kind: SandboxRuntimeKind = getSandboxRuntimeKind()): string {
  return kind;
}

export function isLinuxOnTabRuntimeEnabled(): boolean {
  return getSandboxRuntimeKind() === "linuxontab";
}
