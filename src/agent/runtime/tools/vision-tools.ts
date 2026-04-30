/**
 * Vision description via OpenAI-compatible chat completions (single user message with image_url).
 */

import { LLM_REQUEST_TIMEOUT_MS } from "../constants.js";
import { extractNonStreamAssistantText } from "../context-compression.js";
import { fetchWithTimeout } from "../llm/streaming.js";
import { resolveLlm } from "../llm/provider-config.js";
import fs from "node:fs/promises";
import { normalizeWorkspaceRelativePath, resolveWorkspacePath, toWorkspaceRelative } from "../workspace-paths.js";

function sanitizeHeaders(headers: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = String(k || "").trim();
    if (!name) continue;
    out[name] = String(v ?? "").replace(/[^\x00-\xFF]/g, "");
  }
  return out;
}

async function loadImageUrl(
  raw: string,
  signal?: AbortSignal
): Promise<{ url: string }> {
  let u = raw.trim();
  if (!u) throw new Error("Missing image payload.");
  if (u.startsWith("data:image/")) return { url: u };
  if (u.startsWith("http://") || u.startsWith("https://")) {
    const res = await fetch(u, { signal });
    if (!res.ok) {
      throw new Error(`Fetching image URL failed (${res.status}).`);
    }
    const ctype = String(res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!/^image\//i.test(ctype)) {
      throw new Error(`Fetched resource is not an image (content-type: ${ctype}).`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { url: `data:${ctype};base64,${buf.toString("base64")}` };
  }
  throw new Error("Image must be a data:image/... URL or an http(s) URL to a raster image.");
}

function workspaceImageMimeType(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "avif":
      return "image/avif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return null;
  }
}

async function loadWorkspaceImagePath(raw: string, ctx?: { cwd?: string }): Promise<{ url: string }> {
  const normalized = normalizeWorkspaceRelativePath(raw).replace(/\\/g, "/");
  if (!normalized.startsWith("uploads/")) {
    throw new Error("workspace_relative_image_path must stay under uploads/.");
  }
  const abs = resolveWorkspacePath(ctx, raw);
  const rel = toWorkspaceRelative(abs).replace(/\\/g, "/");
  if (!rel.startsWith("uploads/")) {
    throw new Error("workspace_relative_image_path must stay under uploads/.");
  }
  const mime = workspaceImageMimeType(rel);
  if (!mime) {
    throw new Error("workspace_relative_image_path must point to a supported image file under uploads/.");
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    throw new Error(`workspace_relative_image_path not found: ${rel}`);
  }
  return { url: `data:${mime};base64,${buf.toString("base64")}` };
}

/**
 * Analyze an image using the configured OpenAI-style provider (`/chat/completions`).
 * Prefer `image_data_url` (data:image/…) or http(s) image URL as `image_url`.
 * Requires a vision-capable model (set WEBAGENT_VISION_MODEL when the primary model is text-only).
 */
export async function visionAnalyzeTool(args: Record<string, unknown>, ctx?: { signal?: AbortSignal; env?: NodeJS.ProcessEnv; cwd?: string }) {
  const questionRaw = typeof args.question === "string" ? args.question.trim() : "";
  const question = questionRaw || "Describe this image in detail for someone who cannot see it.";

  const imageCandidate =
    (typeof args.image_data_url === "string" ? args.image_data_url.trim() : "") ||
    (typeof args.image_url === "string" ? args.image_url.trim() : "");
  const fetchSrc = typeof args.fetch_url === "string" ? args.fetch_url.trim() : "";
  const workspaceImagePath =
    typeof args.workspace_relative_image_path === "string"
      ? args.workspace_relative_image_path.trim()
      : "";
  if (workspaceImagePath && (imageCandidate || fetchSrc)) {
    throw new Error("Provide either `workspace_relative_image_path` or `image_data_url`/`image_url`/`fetch_url`, not both.");
  }
  if (!workspaceImagePath && !imageCandidate && !fetchSrc) {
    throw new Error("Provide `workspace_relative_image_path`, `image_data_url`/`image_url` (data URL or http(s)), or `fetch_url` pointing to an image.");
  }

  let imageResolved: { url: string };
  if (workspaceImagePath) imageResolved = await loadWorkspaceImagePath(workspaceImagePath, ctx);
  else if (imageCandidate) imageResolved = await loadImageUrl(imageCandidate, ctx?.signal);
  else imageResolved = await loadImageUrl(fetchSrc, ctx?.signal);

  const cfg = await resolveLlm();
  if (!cfg?.baseUrl || !cfg.model) {
    throw new Error("Vision requires a resolved LLM profile (missing base URL or model).");
  }
  if (!cfg.apiKey) {
    throw new Error("Vision requires an API key for the configured provider.");
  }

  const envVision = ctx?.env?.WEBAGENT_VISION_MODEL ? String(ctx.env.WEBAGENT_VISION_MODEL).trim() : "";
  const visionModel = envVision || String(args.model_override || "").trim() || cfg.model;

  const headers = sanitizeHeaders({
    "Content-Type": "application/json",
    ...(cfg.extraHeaders as Record<string, string>),
    Authorization: `Bearer ${cfg.apiKey}`,
  });

  const endpoint = `${String(cfg.baseUrl).replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: imageResolved.url } },
        ],
      },
    ],
    max_tokens: 2048,
  };

  const res = await fetchWithTimeout(
    endpoint,
    { method: "POST", headers, body: JSON.stringify(body), signal: ctx?.signal },
    LLM_REQUEST_TIMEOUT_MS,
    "vision_analyze chat request"
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Vision request failed (${res.status}). Provider must support OpenAI-style multimodal chat. ${errText.slice(0, 400)}`.trim()
    );
  }

  const payload = await res.json();
  let text = extractNonStreamAssistantText(payload);
  if (!text.trim()) throw new Error("Vision model returned an empty response.");

  const unsupportedHints = /not support|unsupported|vision|multimodal|image input|cannot read image/i.test(text)
    ? " Hint: ensure WEBAGENT_VISION_MODEL is a vision-capable model on your provider."
    : "";

  return {
    ok: true,
    model: visionModel,
    analysis: text.trim(),
    note: unsupportedHints
      ? `If this looks like an error, switch to a multimodal endpoint.${unsupportedHints}`
      : "Responses use the same provider as the agent (OpenAI-compatible chat/completions with image_url parts). Anthropic Messages API differs and is not used here.",
  };
}
