import fs from "node:fs/promises";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { CAPABILITIES_DIR } from "../constants.js";
import { createChannelInboundHandler } from "./dispatcher.js";

async function loadCapabilityChannel(id) {
  const safeId = String(id || "").trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(safeId)) return null;
  const dir = nodePath.join(CAPABILITIES_DIR, "channels", safeId);
  const runtimePath = nodePath.join(dir, "runtime.js");
  const manifestPath = nodePath.join(dir, "manifest.json");
  const stat = await fs.stat(runtimePath).catch(() => null);
  if (!stat?.isFile()) return null;
  const manifest = await fs.readFile(manifestPath, "utf8")
    .then((raw) => JSON.parse(raw))
    .catch(() => ({ id: safeId }));
  const mod = await import(`${pathToFileURL(runtimePath).href}?v=${stat.mtimeMs}`);
  const start = typeof mod.start === "function" ? mod.start : mod.default;
  return typeof start === "function" ? { start, manifest } : null;
}

/**
 * Starts the configured external channel adapter (polling) when WEBAGENT_CHANNEL is set.
 * `agentTurn` should already wrap turn serialization if needed (see agent.js).
 *
 * @param {{
 *   signal: AbortSignal;
 *   agentTurn: (...args: any[]) => Promise<any>;
 *   cfg: Record<string, unknown>;
 *   abortTurn?: (reason?: string) => boolean;
 *   writeStderrStyled?: (line: string) => void;
 * }} deps
 */
export function startChannelSidecar(deps) {
  const { writeStderrStyled } = deps;
  const id = String(process.env.WEBAGENT_CHANNEL || "").trim();
  const noop = () => {};

  if (!id) return { stop: noop };

  let stopped = false;
  let active = { stop: noop };
  void loadCapabilityChannel(id)
    .then((channel) => {
      if (stopped) return;
      if (channel) {
        active = channel.start({ ...deps, manifest: channel.manifest }) || { stop: noop };
        return;
      }
      writeStderrStyled?.(`channel: unknown WEBAGENT_CHANNEL=${id}`);
    })
    .catch((err) => {
      writeStderrStyled?.(
        `channel: failed to load ${id}: ${err instanceof Error ? err.message : String(err)}`
      );
    });

  return {
    stop: () => {
      stopped = true;
      active.stop?.();
    },
  };
}
