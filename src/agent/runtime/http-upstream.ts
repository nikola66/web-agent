import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/** Default upstream User-Agent; include substring `web-agent` for firewall allowlists. */
export const WEB_AGENT_USER_AGENT = `web-agent/${readAppVersion()}`;

/** Ensure outbound proxy requests identify as Web Agent unless caller already did. */
export function withWebAgentUserAgent(headers: Record<string, string> = {}): Record<string, string> {
  const out = { ...headers };
  let uaKey: string | undefined;
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === "user-agent") {
      uaKey = k;
      break;
    }
  }
  const existing = uaKey ? String(out[uaKey]).trim() : "";
  if (!existing) {
    out["User-Agent"] = WEB_AGENT_USER_AGENT;
    return out;
  }
  if (!/web-agent/i.test(existing)) {
    out[uaKey!] = `${existing} (${WEB_AGENT_USER_AGENT})`;
  }
  return out;
}
