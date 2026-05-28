import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")
);

export const WEB_AGENT_USER_AGENT = `web-agent/${pkg.version}`;

export function withWebAgentUserAgent(headers = {}) {
  const out = { ...headers };
  let uaKey;
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
    out[uaKey] = `${existing} (${WEB_AGENT_USER_AGENT})`;
  }
  return out;
}
