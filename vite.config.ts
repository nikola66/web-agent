import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "path";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import {
  buildProxyDebugLogEntry,
  isTransitOnlyProxyMode,
  normalizeLaunchMode,
  sanitizeForLogs,
} from "./src/agent/runtime/privacy";

const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

/** Vite's `ProxyOptions` omits `router` even though the underlying proxy supports it. */
type ProxyWithRouter = ProxyOptions & {
  router?: (req: IncomingMessage) => string;
};

const LLM_PROXY_PREFIX = "/api/llm/";
let APP_ENV: Record<string, string> = {};
function envValue(name: string): string {
  const fromLoaded = APP_ENV[name];
  if (typeof fromLoaded === "string") return fromLoaded;
  return String(process.env[name] || "");
}
const DEBUG_LLM_PROXY = () => envValue("WEBAGENT_DEBUG_LLM_PROXY") === "1";
const DEBUG_PROXY = () => envValue("WEBAGENT_DEBUG_PROXY") === "1" || DEBUG_LLM_PROXY();
const LAUNCH_MODE = () =>
  normalizeLaunchMode(envValue("VITE_WEBAGENT_LAUNCH_MODE") || envValue("WEBAGENT_LAUNCH_MODE"));

function nextProxyRequestId(): string {
  return randomUUID().slice(0, 8);
}

function requestUrlPath(req: IncomingMessage): string {
  try {
    return new URL(String(req.url || ""), "http://localhost").pathname;
  } catch {
    return String(req.url || "").split("?")[0] || "/";
  }
}

function setProxyRequestMeta(req: IncomingMessage, routeId: string) {
  const meta = {
    requestId: nextProxyRequestId(),
    routeId,
    startedAt: Date.now(),
  };
  (req as IncomingMessage & { __webagentProxyMeta?: typeof meta }).__webagentProxyMeta = meta;
  return meta;
}

function getProxyRequestMeta(req: IncomingMessage, routeId: string) {
  const existing = (req as IncomingMessage & {
    __webagentProxyMeta?: { requestId: string; routeId: string; startedAt: number };
  }).__webagentProxyMeta;
  return existing ?? setProxyRequestMeta(req, routeId);
}

function logProxyDebug(req: IncomingMessage, routeId: string, statusCode?: number | null) {
  if (!DEBUG_PROXY()) return;
  const meta = getProxyRequestMeta(req, routeId);
  console.log("[proxy]", JSON.stringify(buildProxyDebugLogEntry({
    requestId: meta.requestId,
    routeId: meta.routeId,
    statusCode,
    durationMs: Date.now() - meta.startedAt,
  })));
}

function logProxyError(req: IncomingMessage, routeId: string, error: unknown) {
  if (!DEBUG_PROXY()) return;
  const meta = getProxyRequestMeta(req, routeId);
  console.error("[proxy]", JSON.stringify({
    ...buildProxyDebugLogEntry({
      requestId: meta.requestId,
      routeId: meta.routeId,
      durationMs: Date.now() - meta.startedAt,
    }),
    error: sanitizeForLogs(error),
  }));
}
function readProviderUpstreams(): Record<string, string> {
  const roots = [
    path.resolve(__dirname, "src/capabilities/providers"),
    path.resolve(__dirname, "src/core/providers"),
  ];
  const out: Record<string, string> = {};
  for (const root of roots) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const manifestPath = entry.isDirectory()
        ? path.join(root, entry.name, "manifest.json")
        : entry.isFile() && entry.name.endsWith(".json")
          ? path.join(root, entry.name)
          : "";
      if (!manifestPath) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const id = String(manifest?.id || "").trim();
        const upstream = String(manifest?.runtime?.fallbackBaseUrl || "").trim();
        if (id && upstream && !out[id]) out[id] = upstream;
      } catch {
        /* ignore invalid provider manifests at proxy setup */
      }
    }
  }
  return out;
}

const PROVIDER_UPSTREAMS: Record<string, string> = readProviderUpstreams();

function llmProxyPathSuffix(pathname: string): string | null {
  const suffix = pathname.startsWith(LLM_PROXY_PREFIX)
    ? pathname.slice(LLM_PROXY_PREFIX.length)
    : pathname.startsWith("/")
      ? pathname.slice(1)
      : pathname;
  const [provider, ...segments] = suffix.split("/").filter(Boolean);
  if (!provider || segments.length === 0 || !PROVIDER_UPSTREAMS[provider]) return null;
  return suffix;
}

function parseProxyTarget(rawUrl: string): { upstreamBase: string; targetPath: string } | null {
  const parsed = new URL(rawUrl, "http://localhost");
  const suffix = llmProxyPathSuffix(parsed.pathname);
  if (!suffix) return null;
  const [provider, ...segments] = suffix.split("/").filter(Boolean);
  if (!provider || segments.length === 0) return null;

  const upstreamBase = PROVIDER_UPSTREAMS[provider];
  if (!upstreamBase) return null;

  const targetPath = `/${segments.join("/")}${parsed.search}`;
  return { upstreamBase, targetPath };
}

const CORS_PROXY_PATH = "/api/proxy";

function crossOriginIsolationHeaders() {
  const gate = (server: {
    middlewares: {
      use: (fn: (req: IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void) => void;
    };
  }) => {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("cross-origin-opener-policy", "same-origin");
      next();
    });
  };
  return {
    name: "cross-origin-isolation-headers",
    enforce: "pre" as const,
    configureServer: gate,
    configurePreviewServer: gate,
  };
}

function corsProxyGate() {
  const gate = (server: {
    middlewares: {
      use: (fn: (req: IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void) => void;
    };
  }) => {
    server.middlewares.use((req, res, next) => {
      if (req.url !== CORS_PROXY_PATH) return next();
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-private-network", "true");
      if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
      if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
      setProxyRequestMeta(req, requestUrlPath(req));
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", async () => {
        try {
          const { method = "GET", url, headers = {}, body } = JSON.parse(
            Buffer.concat(chunks).toString("utf8")
          );
          const upstream = await fetch(url, {
            method,
            headers,
            ...(body != null ? { body } : {}),
          });
          const responseBody = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
          res.end(JSON.stringify({
            status: upstream.status,
            statusText: upstream.statusText,
            body: responseBody,
            contentType: upstream.headers.get("content-type") ?? "",
          }));
          logProxyDebug(req, CORS_PROXY_PATH, upstream.status);
        } catch (e) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
          logProxyError(req, CORS_PROXY_PATH, e);
        }
      });
    });
  };
  return {
    name: "cors-proxy-gate",
    enforce: "pre" as const,
    configureServer: gate,
    configurePreviewServer: gate,
  };
}

function rawRuntimeFilesPlugin() {
  // Intercepts remaining `./runtime/*?raw` imports under src/agent (e.g. HEARTBEAT.md).
  // Compiled runtime `.js` strings come from `dist/agent-runtime/*?raw` and use normal Vite ?raw.
  const runtimeFileCache = new Map<string, string>();

  const loadRawFile = (filePath: string): string => {
    const fullPath = path.resolve(__dirname, "src/agent", filePath);
    if (!runtimeFileCache.has(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        runtimeFileCache.set(fullPath, content);
      } catch (e) {
        console.error(`Failed to load raw runtime file: ${fullPath}`, e);
        throw e;
      }
    }
    return runtimeFileCache.get(fullPath) || "";
  };

  const getModuleCode = (filePath: string): string => {
    const content = loadRawFile(filePath);
    return `export default ${JSON.stringify(content)};`;
  };

  return {
    name: "raw-runtime-files",
    enforce: "pre" as const,
    resolveId(id: string, importer?: string) {
      // Match e.g. `./runtime/HEARTBEAT.md?raw` (paths containing `/runtime/`).
      if (id.includes("/runtime/") && id.endsWith("?raw")) {
        const filePath = id.replace("?raw", "");
        const virtualId = `\0raw-runtime:${filePath}`;
        return virtualId;
      }
    },
    load(id: string) {
      if (id.startsWith("\0raw-runtime:")) {
        const filePath = id.slice("\0raw-runtime:".length);
        return getModuleCode(filePath);
      }
    },
    configureServer(server) {
      // Serve virtual modules in dev mode via HTTP middleware
      return () => {
        server.middlewares.use((req, res, next) => {
          const url = req.url || "";
          // Match Vite's virtual module URL pattern: /@id/__x00__raw-runtime:...
          if (url.includes("/@id/") && url.includes("raw-runtime:")) {
            // Decode the virtual module ID from URL
            const match = url.match(/\/@id\/__x00__raw-runtime:(.+?)(?:\?|$)/);
            if (match) {
              const filePath = match[1];
              try {
                const code = getModuleCode(filePath);
                res.setHeader("Content-Type", "text/javascript; charset=utf-8");
                res.end(code);
                return;
              } catch (e) {
                res.statusCode = 500;
                res.end(`console.error("Failed to load ${filePath}: ${(e as Error).message}")`);
                return;
              }
            }
          }
          next();
        });
      };
    },
  };
}

function llmProxyGate() {
  const gate = (server: {
    middlewares: {
      use: (fn: (req: IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void) => void;
    };
  }) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url || "";
      if (!url.startsWith(LLM_PROXY_PREFIX)) return next();
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        "authorization,content-type,http-referer,x-title,x-openrouter-title,x-webagent-session"
      );
      res.setHeader("access-control-allow-private-network", "true");
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (!parseProxyTarget(url)) {
        res.statusCode = 403;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: "llm_provider_not_allowed",
            allowedProviders: Object.keys(PROVIDER_UPSTREAMS),
          })
        );
        return;
      }
      next();
    });
  };
  return {
    name: "llm-proxy-gate",
    enforce: "pre" as const,
    configureServer: gate,
    configurePreviewServer: gate,
  };
}

function buildLlmProxies(): Record<string, ProxyWithRouter> {
  const proxies: Record<string, ProxyWithRouter> = {};
  for (const [id, upstream] of Object.entries(PROVIDER_UPSTREAMS)) {
    const upstreamUrl = new URL(upstream);
    const basePath = upstreamUrl.pathname.replace(/\/$/, "") || "";
    const matchedPrefix = `/api/llm/${id}`;
    proxies[matchedPrefix] = {
      target: upstreamUrl.origin,
      changeOrigin: true,
      secure: true,
      ws: true,
      rewrite: (path) => {
        const tail = path.startsWith(matchedPrefix)
          ? path.slice(matchedPrefix.length)
          : path;
        const normalizedTail = tail.startsWith("/") ? tail : tail ? `/${tail}` : "/";
        return `${basePath}${normalizedTail}`;
      },
      configure(proxy) {
        proxy.on("error", (err) => {
          console.error("[llm proxy]", JSON.stringify(sanitizeForLogs(err)));
        });
        proxy.on("proxyReq", (proxyReq, req) => {
          setProxyRequestMeta(req, `llm:${id}`);
          if (id === "openrouter" && !proxyReq.getHeader("authorization")) {
            const fallbackKey = String(APP_ENV.OPENROUTER_API_KEY || "").trim();
            if (fallbackKey) {
              proxyReq.setHeader("Authorization", `Bearer ${fallbackKey}`);
            }
          }
        });
        proxy.on("proxyRes", (proxyRes, req) => {
          logProxyDebug(req, `llm:${id}`, proxyRes.statusCode ?? null);
        });
      },
    };
  }
  return proxies;
}

const LLM_PROXIES = buildLlmProxies();

export default defineConfig(({ mode }) => {
  APP_ENV = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && !isTransitOnlyProxyMode(LAUNCH_MODE())) {
    console.warn("[privacy] Production deploys should set VITE_WEBAGENT_LAUNCH_MODE=transit_only_proxy.");
  }
  return {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(PACKAGE_JSON.version),
    },
    plugins: [rawRuntimeFilesPlugin(), crossOriginIsolationHeaders(), llmProxyGate(), corsProxyGate(), react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@embed-runtime": path.resolve(__dirname, "./dist/agent-runtime"),
      },
    },
    worker: {
      format: "es",
    },
    build: {
      emptyOutDir: false,
      target: "es2022",
      cssCodeSplit: true,
      sourcemap: false,
      rollupOptions: {
        external: [],
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, "/");
            if (normalized.includes("/node_modules/sql.js/")) return "sqljs";
            if (normalized.includes("/node_modules/@xterm/")) return "xterm";
            if (normalized.includes("/node_modules/@codesandbox/nodebox/")) return "nodebox";
            if (normalized.includes("/node_modules/markdown-it/")) return "markdown";
            if (normalized.includes("/node_modules/lucide-react/")) return "icons";
            if (
              normalized.includes("/node_modules/react/") ||
              normalized.includes("/node_modules/react-dom/") ||
              normalized.includes("/node_modules/scheduler/")
            )
              return "react-vendor";
            if (normalized.includes("/node_modules/zustand/")) return "zustand";
            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        ...LLM_PROXIES,
      },
    },
    preview: {
      proxy: {
        ...LLM_PROXIES,
      },
    },
  };
});
