/**
 * Same-origin JSON CORS proxy for static + Caddy production deploys.
 * Contract matches vite.config.ts `corsProxyGate` (POST /api/proxy).
 * Bind locally only; this endpoint relays arbitrary URLs from the request body.
 */
import http from "node:http";

const PATH = "/api/proxy";
const host = process.env.WEBAGENT_CORS_PROXY_HOST || "127.0.0.1";
const port = Number(process.env.WEBAGENT_CORS_PROXY_PORT || "8799") || 8799;

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-private-network", "true");
}

const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url || "", `http://${host}`);
    if (u.pathname !== PATH) {
      res.statusCode = 404;
      res.end();
      return;
    }
    setCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const { method = "GET", url, headers = {}, body } = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        const upstream = await fetch(url, {
          method,
          headers,
          ...(body != null ? { body } : {}),
        });
        const responseBody = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader(
          "content-type",
          upstream.headers.get("content-type") ?? "application/octet-stream",
        );
        res.end(
          JSON.stringify({
            status: upstream.status,
            statusText: upstream.statusText,
            body: responseBody,
            contentType: upstream.headers.get("content-type") ?? "",
          }),
        );
      } catch (e) {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
      }
    });
  } catch {
    res.statusCode = 500;
    res.end();
  }
});

server.listen(port, host, () => {
  console.error(`[cors-proxy-server] listening on http://${host}:${port}${PATH}`);
});
