import { expect, test } from "@playwright/test";

const VIDEO_URL = "https://www.youtube.com/watch?v=DlzkIjhJ18o";
const VIDEO_ID = "DlzkIjhJ18o";
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";

type ProxyPayload = {
  status?: number;
  body?: string;
  error?: string;
  contentType?: string;
};

async function proxyPost(
  origin: string,
  request: { method?: string; url: string; headers?: Record<string, string>; body?: string }
): Promise<ProxyPayload> {
  const res = await fetch(`${origin}/api/proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return (await res.json()) as ProxyPayload;
}

function parsePlayerBody(body: string) {
  const trimmed = String(body ?? "").trim();
  expect(trimmed.length, "player body should not be empty").toBeGreaterThan(0);
  expect(trimmed.startsWith("<"), "player body should not be HTML").toBe(false);
  return JSON.parse(trimmed) as Record<string, unknown>;
}

test.describe("YouTube transcribe (live browser /api/proxy)", () => {
  test("InnerTube player via browser proxy returns JSON (not parse failure)", async ({ page, baseURL }) => {
    await page.goto(baseURL!);
    const origin = new URL(page.url()).origin;

    const payload = await page.evaluate(
      async ({ origin, videoId, key, ua }) => {
        const res = await fetch(`${origin}/api/proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "POST",
            url: `https://www.youtube.com/youtubei/v1/player?key=${key}`,
            headers: { "Content-Type": "application/json", "User-Agent": ua },
            body: JSON.stringify({
              context: {
                client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en", gl: "US" },
              },
              videoId,
            }),
          }),
        });
        return (await res.json()) as { status?: number; body?: string; error?: string };
      },
      { origin, videoId: VIDEO_ID, key: INNERTUBE_KEY, ua: ANDROID_UA }
    );

    expect(payload.error, `proxy error: ${payload.error}`).toBeFalsy();
    expect(payload.status, "YouTube HTTP status").toBeGreaterThanOrEqual(200);
    expect(payload.status!, "YouTube HTTP status").toBeLessThan(300);

    const player = parsePlayerBody(String(payload.body ?? ""));
    const playability = player.playabilityStatus as Record<string, unknown> | undefined;
    const tracks =
      (
        (player.captions as Record<string, unknown> | undefined)?.playerCaptionsTracklistRenderer as
          | Record<string, unknown>
          | undefined
      )?.captionTracks ?? [];

    test.info().annotations.push({
      type: "youtube-playability",
      description: `${String(playability?.status ?? "unknown")}: ${String(playability?.reason ?? "").slice(0, 120)}`,
    });
    test.info().annotations.push({
      type: "caption-tracks",
      description: String(Array.isArray(tracks) ? tracks.length : 0),
    });

    // Regression: we must never hit the old opaque "could not be parsed" path (empty/HTML body).
    expect(String(payload.body ?? "").trim().startsWith("{"), "body should be JSON object").toBe(true);
  });

  test("watch-page fetch via browser proxy returns HTML (may be truncated at 100k)", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL!);
    const origin = new URL(page.url()).origin;

    const payload = await page.evaluate(
      async ({ origin, videoId, ua }) => {
        const res = await fetch(`${origin}/api/proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "GET",
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            headers: { "User-Agent": ua, Accept: "text/html" },
          }),
        });
        return (await res.json()) as {
          status?: number;
          body?: string;
          error?: string;
          truncated?: boolean;
        };
      },
      { origin, videoId: VIDEO_ID, ua: ANDROID_UA }
    );

    expect(payload.error).toBeFalsy();
    expect(payload.status).toBeGreaterThanOrEqual(200);
    expect(payload.status!).toBeLessThan(300);
    const html = String(payload.body ?? "");
    expect(html.length).toBeGreaterThan(1000);
    expect(html.toLowerCase().includes("youtube")).toBe(true);
    // Player JSON is often >100k into the document; proxy caps body at 100k.
    test.info().annotations.push({
      type: "watch-html",
      description: `len=${html.length} truncated=${Boolean(payload.truncated)} hasPlayerMarker=${html.includes("ytInitialPlayerResponse")}`,
    });
  });

  test("full caption pull when tracks are available", async ({ page, baseURL }) => {
    await page.goto(baseURL!);
    const origin = new URL(page.url()).origin;

    const playerPayload = await proxyPost(origin, {
      method: "POST",
      url: `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
      headers: { "Content-Type": "application/json", "User-Agent": ANDROID_UA },
      body: JSON.stringify({
        context: {
          client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en", gl: "US" },
        },
        videoId: VIDEO_ID,
      }),
    });

    expect(playerPayload.error).toBeFalsy();
    const player = parsePlayerBody(String(playerPayload.body ?? ""));
    const tracks = (
      (
        (player.captions as Record<string, unknown> | undefined)?.playerCaptionsTracklistRenderer as
          | Record<string, unknown>
          | undefined
      )?.captionTracks ?? []
    ) as Array<{ baseUrl?: string; languageCode?: string }>;

    const playability = player.playabilityStatus as Record<string, unknown> | undefined;
    if (!tracks.length) {
      test.skip(
        true,
        `No caption tracks from browser IP (status=${String(playability?.status)}). Bot-check is environmental, not a parse bug.`
      );
      return;
    }

    const track = tracks.find((t) => t.languageCode === "en") ?? tracks[0];
    expect(track?.baseUrl, "caption track needs baseUrl").toBeTruthy();

    const capPayload = await proxyPost(origin, {
      url: String(track.baseUrl),
      headers: { "User-Agent": ANDROID_UA },
    });
    expect(capPayload.error).toBeFalsy();
    expect(capPayload.status).toBeGreaterThanOrEqual(200);
    expect(capPayload.status!).toBeLessThan(300);
    const xml = String(capPayload.body ?? "").trim();
    expect(xml.length).toBeGreaterThan(0);
    expect(xml.includes("<p") || xml.includes("<text"), "caption payload should be timedtext XML").toBe(true);

    test.info().annotations.push({
      type: "transcript-sample",
      description: xml.slice(0, 200).replace(/\s+/g, " "),
    });
  });
});
