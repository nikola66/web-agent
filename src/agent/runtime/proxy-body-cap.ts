/** Default /api/proxy text body cap (web_fetch, etc.). */
export const PROXY_TEXT_BODY_CAP = 100_000;
/** InnerTube ANDROID player payloads exceed 100k; caption discovery needs the full JSON. */
export const YOUTUBE_PROXY_BODY_CAP = 512_000;

export function isYouTubeUpstreamUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "youtu.be" ||
      host.endsWith(".youtube.com") ||
      host === "youtube.com" ||
      host.endsWith(".googlevideo.com") ||
      host === "googlevideo.com"
    );
  } catch {
    return false;
  }
}

export function proxyTextBodyCapForUrl(url: string): number {
  return isYouTubeUpstreamUrl(url) ? YOUTUBE_PROXY_BODY_CAP : PROXY_TEXT_BODY_CAP;
}
