import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isYouTubeUpstreamUrl } from "./proxy-body-cap.js";

export {
  PROXY_TEXT_BODY_CAP,
  YOUTUBE_PROXY_BODY_CAP,
  isYouTubeUpstreamUrl,
  proxyTextBodyCapForUrl,
} from "./proxy-body-cap.js";

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version?: string;
    };
    return String(pkg.version || "dev").trim() || "dev";
  } catch {
    return "dev";
  }
}

export const WEB_AGENT_USER_AGENT = `web-agent/${readAppVersion()}`;

/** YouTube blocks or degrades requests that advertise a non-browser automation UA. */
export function withWebAgentUserAgent(
  headers: Record<string, string> = {},
  options: { url?: string } = {}
): Record<string, string> {
  if (options.url && isYouTubeUpstreamUrl(options.url)) {
    return { ...headers };
  }
  const out = { ...headers };
  let uaKey: string | undefined =
    "User-Agent" in out ? "User-Agent" : "user-agent" in out ? "user-agent" : undefined;
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
