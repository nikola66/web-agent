import { looksLikeHtmlDocument } from "../tool-result-preview.js";
import { ipcProxyRequest, readProxyResponse } from "../ipc.js";

/** Public InnerTube key used by the YouTube web client (stable for years). */
export const YOUTUBE_INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

const YOUTUBE_ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";

/** Clients tried in order until caption tracks are returned. */
const INNERTUBE_PLAYER_CLIENTS = [
  { clientName: "ANDROID", clientVersion: "20.10.38" },
  { clientName: "IOS", clientVersion: "19.45.4" },
  { clientName: "MWEB", clientVersion: "2.20240401.00.00" },
  { clientName: "WEB", clientVersion: "2.20260528.01.00" },
  { clientName: "TVHTML5", clientVersion: "7.20240401.00.00" },
] as const;

export type YouTubeCaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string };
};

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1).split(/[?&#]/)[0];
      return id || null;
    }
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v") || null;
  } catch {
    /* invalid URL */
  }
  return null;
}

export function decodeHtmlEntities(text: string): string {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

export function parseCaptionXml(xml: string): string[] {
  const segments: string[] = [];
  const pMatches = [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  for (const pm of pMatches) {
    const inner = pm[1];
    const sMatches = [...inner.matchAll(/<s[^>]*>([^<]*)<\/s>/g)];
    if (sMatches.length) {
      segments.push(sMatches.map((m) => m[1]).join(""));
    } else {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      if (text) segments.push(text);
    }
  }
  return segments
    .map((s) => decodeHtmlEntities(s).replace(/\n/g, " ").trim())
    .filter(Boolean);
}

/** Brace-balanced JSON parse for `ytInitialPlayerResponse` embedded in watch HTML. */
export function parseYtInitialPlayerResponse(html: string): Record<string, unknown> | null {
  const marker = "ytInitialPlayerResponse";
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf("{", idx);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function captionTracksFromPlayerData(
  playerData: Record<string, unknown> | null | undefined
): YouTubeCaptionTrack[] {
  const captions = playerData?.captions as Record<string, unknown> | undefined;
  const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
  const tracks = renderer?.captionTracks;
  return Array.isArray(tracks) ? (tracks as YouTubeCaptionTrack[]) : [];
}

export function parseInnertubePlayerBody(
  body: string,
  meta: { proxyError?: string; status?: number } = {}
): Record<string, unknown> {
  const trimmed = String(body ?? "").trim();
  if (!trimmed) {
    const proxyHint = meta.proxyError ? ` Proxy error: ${meta.proxyError}.` : "";
    throw new Error(
      `YouTube player API returned an empty body (HTTP ${meta.status ?? 0}).${proxyHint} Ensure the local CORS proxy is running (/api/proxy).`
    );
  }
  if (looksLikeHtmlDocument(trimmed)) {
    throw new Error(
      "YouTube player API returned HTML instead of JSON — usually a proxy misroute, SPA shell, or bot-check page. Confirm /api/proxy is reachable."
    );
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const preview = trimmed.slice(0, 160).replace(/\s+/g, " ");
    throw new Error(`YouTube player response could not be parsed. Body preview: ${preview}`);
  }
}

export function formatMissingCaptionsError(playerData: Record<string, unknown>): string {
  const playability = playerData?.playabilityStatus as Record<string, unknown> | undefined;
  const status = String(playability?.status ?? "");
  const reason = String(playability?.reason ?? "").trim();
  if (status === "LOGIN_REQUIRED") {
    return (
      "YouTube blocked automated caption access (bot check: sign-in required). " +
      "This is not a missing-transcript issue — retry later, try another network, or use web_fetch on the watch page for title/description."
    );
  }
  if (status && status !== "OK") {
    return `Video unavailable for captions: ${reason || status}`;
  }
  return "No captions available for this video.";
}

type ProxyCtx = unknown;

async function youtubeProxy(
  request: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: string | null;
  },
  _ctx: ProxyCtx
) {
  void _ctx;
  const headers: Record<string, string> = {
    "User-Agent": YOUTUBE_ANDROID_UA,
    "Accept-Language": "en-US,en;q=0.9",
    ...request.headers,
  };
  return readProxyResponse(
    await ipcProxyRequest({
      method: request.method ?? "GET",
      url: request.url,
      headers,
      body: request.body ?? null,
    })
  );
}

async function fetchInnertubePlayer(
  videoId: string,
  client: (typeof INNERTUBE_PLAYER_CLIENTS)[number],
  ctx: ProxyCtx
): Promise<Record<string, unknown> | null> {
  const { status, body, proxyError } = await youtubeProxy(
    {
      method: "POST",
      url: `https://www.youtube.com/youtubei/v1/player?key=${YOUTUBE_INNERTUBE_API_KEY}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: "en",
            gl: "US",
          },
        },
        videoId,
      }),
    },
    ctx
  );
  if (status < 200 || status >= 300) {
    throw new Error(`YouTube player API returned ${status}.${proxyError ? ` ${proxyError}` : ""}`);
  }
  return parseInnertubePlayerBody(body, { proxyError, status });
}

async function fetchWatchPagePlayer(videoId: string, ctx: ProxyCtx): Promise<Record<string, unknown> | null> {
  const { status, body, proxyError } = await youtubeProxy(
    {
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      headers: { Accept: "text/html,application/xhtml+xml" },
    },
    ctx
  );
  if (status < 200 || status >= 300) {
    throw new Error(`YouTube watch page returned ${status}.${proxyError ? ` ${proxyError}` : ""}`);
  }
  const html = String(body ?? "");
  if (!html.trim()) {
    throw new Error("YouTube watch page returned an empty body.");
  }
  return parseYtInitialPlayerResponse(html);
}

/**
 * Resolve caption track metadata via InnerTube (multiple clients) then watch-page embed.
 */
export async function fetchYouTubeCaptionTracks(
  videoId: string,
  ctx: ProxyCtx
): Promise<YouTubeCaptionTrack[]> {
  let lastPlayer: Record<string, unknown> | null = null;

  for (const client of INNERTUBE_PLAYER_CLIENTS) {
    try {
      const playerData = await fetchInnertubePlayer(videoId, client, ctx);
      lastPlayer = playerData;
      const tracks = captionTracksFromPlayerData(playerData);
      if (tracks.length) return tracks;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/could not be parsed|empty body|HTML instead of JSON/i.test(msg)) throw e;
      /* try next client */
    }
  }

  try {
    const pagePlayer = await fetchWatchPagePlayer(videoId, ctx);
    if (pagePlayer) {
      lastPlayer = pagePlayer;
      const tracks = captionTracksFromPlayerData(pagePlayer);
      if (tracks.length) return tracks;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/could not be parsed|empty body|HTML instead of JSON/i.test(msg)) throw e;
  }

  throw new Error(formatMissingCaptionsError(lastPlayer ?? {}));
}
