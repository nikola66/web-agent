import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captionTracksFromPlayerData,
  decodeHtmlEntities,
  extractYouTubeVideoId,
  formatMissingCaptionsError,
  parseCaptionXml,
  parseInnertubePlayerBody,
  parseYtInitialPlayerResponse,
} from "../src/agent/runtime/tools/youtube-caption-fetch.js";
import {
  isYouTubeUpstreamUrl,
  proxyTextBodyCapForUrl,
  YOUTUBE_PROXY_BODY_CAP,
} from "../src/agent/runtime/proxy-body-cap.js";
import { withWebAgentUserAgent } from "../src/agent/runtime/http-upstream.js";

test("extractYouTubeVideoId handles watch and youtu.be URLs", () => {
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/watch?v=DlzkIjhJ18o"), "DlzkIjhJ18o");
  assert.equal(extractYouTubeVideoId("https://youtu.be/DlzkIjhJ18o"), "DlzkIjhJ18o");
  assert.equal(extractYouTubeVideoId("https://example.com"), null);
});

test("parseCaptionXml extracts timedtext segments", () => {
  const xml = `<p t="0"><s acc="0">Hello</s><s acc="0"> world</s></p><p t="1000"><s acc="0">Again</s></p>`;
  assert.deepEqual(parseCaptionXml(xml), ["Hello world", "Again"]);
});

test("decodeHtmlEntities decodes common entities", () => {
  assert.equal(decodeHtmlEntities("a &amp; b &lt;c&gt;"), "a & b <c>");
});

test("parseYtInitialPlayerResponse extracts embedded JSON", () => {
  const payload = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en" }] } } };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(payload)};</script>`;
  const parsed = parseYtInitialPlayerResponse(html);
  assert.equal(captionTracksFromPlayerData(parsed).length, 1);
});

test("parseInnertubePlayerBody rejects empty and HTML bodies", () => {
  assert.throws(() => parseInnertubePlayerBody(""), /empty body/i);
  assert.throws(() => parseInnertubePlayerBody("<!DOCTYPE html><html>"), /HTML instead of JSON/i);
  assert.throws(() => parseInnertubePlayerBody("not-json"), /could not be parsed/i);
  assert.throws(
    () => parseInnertubePlayerBody('{"responseContext":{', { truncated: true, truncated_at_chars: 100_000 }),
    /truncated/i
  );
  assert.deepEqual(parseInnertubePlayerBody('{"ok":true}'), { ok: true });
});

test("formatMissingCaptionsError explains LOGIN_REQUIRED bot checks", () => {
  const msg = formatMissingCaptionsError({
    playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" },
  });
  assert.match(msg, /bot check/i);
});

test("proxyTextBodyCapForUrl raises cap for YouTube upstream", () => {
  assert.equal(
    proxyTextBodyCapForUrl("https://www.youtube.com/youtubei/v1/player"),
    YOUTUBE_PROXY_BODY_CAP
  );
  assert.equal(proxyTextBodyCapForUrl("https://example.com"), 100_000);
});

test("isYouTubeUpstreamUrl and withWebAgentUserAgent skip YouTube hosts", () => {
  assert.equal(isYouTubeUpstreamUrl("https://www.youtube.com/youtubei/v1/player"), true);
  assert.equal(isYouTubeUpstreamUrl("https://rr1---sn.googlevideo.com/videoplayback"), true);
  assert.equal(isYouTubeUpstreamUrl("https://example.com"), false);
  const yt = withWebAgentUserAgent({ "User-Agent": "com.google.android.youtube/20" }, {
    url: "https://www.youtube.com/youtubei/v1/player",
  });
  assert.equal(yt["User-Agent"], "com.google.android.youtube/20");
  const other = withWebAgentUserAgent({ "User-Agent": "curl/8" }, { url: "https://example.com" });
  assert.match(other["User-Agent"] || "", /web-agent/i);
});
