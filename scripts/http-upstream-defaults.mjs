import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readAppVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")
    );
    return String(pkg.version || "dev").trim() || "dev";
  } catch {
    return "dev";
  }
}

export const WEB_AGENT_USER_AGENT = `web-agent/${readAppVersion()}`;

export function isYouTubeUpstreamUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "youtu.be" ||
      host.endsWith(".youtube.com") ||
      host === "youtube.com" ||
      host.endsWith(".googlevideo.com") ||
      host === "googlevideo.com"
    );
  } catch {
    return false;
  }
}

export function withWebAgentUserAgent(headers = {}, options = {}) {
  if (options.url && isYouTubeUpstreamUrl(options.url)) {
    return { ...headers };
  }
  const out = { ...headers };
  let uaKey = "User-Agent" in out ? "User-Agent" : "user-agent" in out ? "user-agent" : undefined;
  if (!uaKey) {
    for (const k of Object.keys(out)) {
      if (k.toLowerCase() === "user-agent") {
        uaKey = k;
        break;
      }
    }
  }
  const existing = uaKey ? String(out[uaKey]).trim() : "";
  if (!existing) {
    out["User-Agent"] = WEB_AGENT_USER_AGENT;
    return out;
  }
  if (!/web-agent/i.test(existing) && uaKey) {
    out[uaKey] = `${existing} (${WEB_AGENT_USER_AGENT})`;
  }
  return out;
}
