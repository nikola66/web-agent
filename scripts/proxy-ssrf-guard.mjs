/**
 * SSRF guard for the same-origin CORS proxy (prod `cors-proxy-server.mjs` and dev
 * `vite.config.ts` `corsProxyGate`). The proxy runs server-side, so a prompt-injected
 * agent could otherwise make the deploy host fetch cloud-metadata (169.254.169.254),
 * internal services, or `file:`/`data:` URLs. We block those targets before `fetch`.
 *
 * Scope: literal-IP + hostname checks only — not full DNS resolution. DNS-rebinding by a
 * determined remote attacker is out of scope for a single-user agent; this stops the
 * prompt-injection exfil vector (literal metadata/internal URLs). Set
 * WEBAGENT_PROXY_ALLOW_PRIVATE=1 to allow private/loopback/link-local targets (still
 * blocks non-http(s) protocols and metadata hostnames) for local-dev use.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Hostnames that always resolve to the host / link-local, regardless of opt-out. */
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
]);

export class ProxyTargetBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProxyTargetBlockedError";
    this.proxyBlocked = true;
  }
}

function stripIpv6Brackets(host) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function ipv4ToOctets(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return null;
  return octets;
}

function isPrivateIpv4(octets) {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 (unspecified)
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

function isPrivateIpv6(raw) {
  const host = raw.toLowerCase();
  // IPv4-mapped in dotted form (::ffff:127.0.0.1) — defer to the embedded v4.
  const dotted = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(host);
  if (dotted) {
    const octets = ipv4ToOctets(dotted[1]);
    if (octets) return isPrivateIpv4(octets);
  }
  // IPv4-mapped after URL normalization to hextets (::ffff:7f00:1 === 127.0.0.1).
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIpv4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]);
  }
  if (host === "::1" || host === "::") return true; // loopback / unspecified
  if (host.startsWith("fe80")) return true; // link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique-local fc00::/7
  return false;
}

/** True for IP literals / hostnames that point at the host or a private network. */
function isPrivateHost(host) {
  const octets = ipv4ToOctets(host);
  if (octets) return isPrivateIpv4(octets);
  if (host.includes(":")) return isPrivateIpv6(host);
  const lower = host.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".internal") || lower.endsWith(".local")) return true;
  return false;
}

function isMetadataHost(host) {
  const lower = host.toLowerCase().replace(/\.$/, "");
  if (METADATA_HOSTNAMES.has(lower)) return true;
  const octets = ipv4ToOctets(host);
  if (octets && octets[0] === 169 && octets[1] === 254) return true; // 169.254.169.254 etc.
  return false;
}

/** Throws ProxyTargetBlockedError when the URL must not be proxied. */
export function assertProxyTargetAllowed(rawUrl, env = (typeof process !== "undefined" ? process.env : {})) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new ProxyTargetBlockedError("proxy: invalid or missing target URL");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new ProxyTargetBlockedError(
      `proxy: protocol '${parsed.protocol}' not allowed (only http/https)`
    );
  }
  const host = stripIpv6Brackets(parsed.hostname);
  if (!host) throw new ProxyTargetBlockedError("proxy: target URL has no host");

  // Cloud metadata + always-host names are blocked even with the opt-out.
  if (isMetadataHost(host)) {
    throw new ProxyTargetBlockedError(`proxy: blocked metadata/link-local target '${host}'`);
  }
  const allowPrivate = String(env?.WEBAGENT_PROXY_ALLOW_PRIVATE || "") === "1";
  if (!allowPrivate && isPrivateHost(host)) {
    throw new ProxyTargetBlockedError(
      `proxy: blocked private/loopback target '${host}' (set WEBAGENT_PROXY_ALLOW_PRIVATE=1 to allow)`
    );
  }
}

// Mirror of CREDENTIAL_PATTERN in src/core/mcp/server-task.ts — keep in sync.
const CREDENTIAL_PATTERN =
  /(?:ghp_[A-Za-z0-9_]{1,255}|sk-[A-Za-z0-9_]{1,255}|Bearer\s+\S+|token=[^\s&,;"']{1,255}|key=[^\s&,;"']{1,255}|API_KEY=[^\s&,;"']{1,255}|password=[^\s&,;"']{1,255}|secret=[^\s&,;"']{1,255})/gi;

/** Redact credentials from a proxy error string before it reaches the client. */
export function redactProxyError(text) {
  return String(text || "").replace(CREDENTIAL_PATTERN, "[REDACTED]");
}
