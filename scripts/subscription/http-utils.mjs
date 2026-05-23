export function requestUrlPath(req) {
  try {
    return new URL(String(req.url || ""), "http://localhost").pathname;
  } catch {
    return String(req.url || "").split("?")[0] || "/";
  }
}

export async function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export async function readRequestJson(req) {
  const body = await readRequestBody(req);
  if (!body || body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

export function setSubscriptionLlmCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "authorization,content-type,http-referer,x-title,x-openrouter-title,x-webagent-session,x-webagent-profile-id"
  );
  res.setHeader("access-control-allow-private-network", "true");
}

export function setSubscriptionOAuthCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}
