import { synthesizeEdgeMp3 } from "./edge-tts-synth.mjs";
import { listEnUsVoices } from "./edge-tts-voices.mjs";

export const EDGE_TTS_PATH = "/api/edge-tts";
export const EDGE_TTS_VOICES_PATH = "/api/edge-tts/voices";

function isLocalhostRemote(remote) {
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

function setEdgeTtsCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function isEdgeTtsPath(pathname) {
  return pathname === EDGE_TTS_PATH || pathname === EDGE_TTS_VOICES_PATH;
}

/** Handle Edge TTS API routes. Returns true if the request was handled. */
export async function handleEdgeTtsHttp(req, res, { pathname, localhostOnly = false } = {}) {
  const route = pathname ?? requestPathname(req.url);
  if (!isEdgeTtsPath(route)) return false;

  const remote = req.socket?.remoteAddress ?? "";
  if (localhostOnly && !isLocalhostRemote(remote)) {
    res.statusCode = 403;
    res.end();
    return true;
  }
  setEdgeTtsCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route === EDGE_TTS_VOICES_PATH) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.end();
      return true;
    }
    try {
      const voices = await listEnUsVoices();
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(voices));
    } catch (e) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
    }
    return true;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return true;
  }
  try {
    const { text, voice, rate } = await readJsonBody(req);
    const mp3 = await synthesizeEdgeMp3(text, voice, rate);
    res.statusCode = 200;
    res.setHeader("content-type", "audio/mpeg");
    res.end(mp3);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    res.statusCode = msg === "empty text" ? 400 : 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: msg }));
  }
  return true;
}

export function requestPathname(url) {
  try {
    return new URL(String(url || ""), "http://localhost").pathname;
  } catch {
    return String(url || "").split("?")[0] || "/";
  }
}
