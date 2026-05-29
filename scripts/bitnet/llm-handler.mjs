import { Readable } from "node:stream";
import { BITNET_PROVIDER_ID, bitnetDemoUrl, bitnetDevice } from "./constants.mjs";
import {
  buildDemoPayload,
  createStreamChunkId,
  mapDemoHttpError,
  openAiChunkLine,
  parseDemoSseBuffer,
} from "./translate.mjs";
import {
  readRequestJson,
  requestUrlPath,
  sendJson,
  setSubscriptionLlmCors,
} from "../subscription/http-utils.mjs";

export function isBitnetLlmPath(url) {
  return requestUrlPath({ url }).startsWith("/api/llm/bitnet/");
}

export function parseBitnetLlmTarget(url) {
  const parsed = new URL(url, "http://localhost");
  const prefix = "/api/llm/";
  if (!parsed.pathname.startsWith(`${prefix}${BITNET_PROVIDER_ID}/`)) return null;
  const suffix = parsed.pathname.slice(`${prefix}${BITNET_PROVIDER_ID}`.length);
  return { targetPath: suffix.startsWith("/") ? suffix : `/${suffix}` };
}

function normalizeProfileId(header) {
  const raw = String(header || "").trim();
  return raw || "default";
}

function normalizeSessionId(req, profileId) {
  const session = String(req.headers["x-webagent-session"] || "").trim();
  return session || profileId;
}

export async function handleBitnetLlmProxy(req, res) {
  const parsed = parseBitnetLlmTarget(req.url || "");
  if (!parsed) return false;

  if (parsed.targetPath !== "/chat/completions") {
    sendJson(res, 404, { error: "not_found" });
    return true;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const body = await readRequestJson(req);
  if (body.stream === false) {
    sendJson(res, 501, { error: "non_streaming_not_supported" });
    return true;
  }

  const profileId = normalizeProfileId(req.headers["x-webagent-profile-id"]);
  const sessionId = normalizeSessionId(req, profileId);
  const payload = buildDemoPayload({
    messages: body.messages,
    profileId,
    sessionId,
    device: bitnetDevice(),
  });
  if (!payload.ok) {
    sendJson(res, 400, { error: payload.error });
    return true;
  }

  const demoUrl = `${bitnetDemoUrl()}/completion`;
  let upstream;
  try {
    upstream = await fetch(demoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 502, { error: `BitNet demo unreachable: ${message}` });
    return true;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    const mapped = mapDemoHttpError(upstream.status, text);
    sendJson(res, mapped.status, { error: mapped.message });
    return true;
  }

  const model = String(body.model || "bitnet-b1.58-2b-4t");
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");

  if (!upstream.body) {
    const id = createStreamChunkId();
    res.write(openAiChunkLine(id, model, {}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
    return true;
  }

  const state = { id: createStreamChunkId(), model, finished: false };
  let buffer = "";

  Readable.fromWeb(upstream.body)
    .on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const { lines, remainder } = parseDemoSseBuffer(buffer, state);
      buffer = remainder;
      for (const line of lines) res.write(line);
    })
    .on("end", () => {
      if (!state.finished) {
        res.write(openAiChunkLine(state.id, state.model, {}, "stop"));
        res.write("data: [DONE]\n\n");
      }
      res.end();
    })
    .on("error", (error) => {
      if (!res.writableEnded) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          res.write(
            `data: ${JSON.stringify({ error: { message: `BitNet stream error: ${message}` } })}\n\n`
          );
        } catch {
          /* response may already be closed */
        }
        res.end();
      }
    });

  return true;
}

export async function handleBitnetHttp(req, res) {
  if (!isBitnetLlmPath(req.url)) return false;
  setSubscriptionLlmCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return handleBitnetLlmProxy(req, res);
}
