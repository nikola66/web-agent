/**
 * Route HTTP intent away from run_shell toward web_fetch / web_post.
 */

export type HttpToolKind = "get" | "post" | "graphql" | "upload" | "unknown_http";

export type HttpIntentDetection = {
  detected: boolean;
  kind: HttpToolKind;
  suggested_tool: "web_fetch" | "web_post" | "web_upload";
  recovery_hint: string;
  example_args: Record<string, unknown>;
};

const POST_MARKERS =
  /\baxios\.(post|patch|put|delete)\b|\bfetch\s*\([^)]*,\s*\{[^}]*method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]|\bmethod\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]|\b(?:POST|PATCH|PUT|DELETE)\b.*\/graphql/i;
const GRAPHQL_MARKERS = /\/graphql\b|"query"\s*:|'query'\s*:|graphql\s*\(/i;
const UPLOAD_MARKERS =
  /\b(?:curl|wget)\s+[^\n]*(?:-F\b|--form\b)|multipart\/form-data|FormData\b|upload.*\/files\b|\/files['"]\s*,/i;
const GET_MARKERS =
  /\baxios\.get\b|\brequire\s*\(\s*['"]axios['"]\)|\bfrom\s+['"]axios['"]|\bfetch\s*\(|\bhttps?\.request\b|\bnode:https\b|\bnode:http\b/i;

function extractNodeEvalBody(command: string): string {
  const trimmed = String(command || "").trim();
  const m = trimmed.match(/^node\b\s+(?:-e|--eval)\s+([\s\S]+)$/i);
  if (!m) return "";
  let body = m[1].trim();
  if (
    (body.startsWith('"') && body.endsWith('"')) ||
    (body.startsWith("'") && body.endsWith("'"))
  ) {
    body = body.slice(1, -1);
  }
  return body;
}

function pickSuggestedTool(kind: HttpToolKind): "web_fetch" | "web_post" | "web_upload" {
  if (kind === "upload") return "web_upload";
  return kind === "post" || kind === "graphql" ? "web_post" : "web_fetch";
}

function defaultExampleArgs(tool: "web_fetch" | "web_post" | "web_upload"): Record<string, unknown> {
  if (tool === "web_upload") {
    return {
      upload_url: "https://cms.example.com/files",
      headers: { Authorization: "Bearer <token>" },
      file_path: "projects/images/hero.jpg",
      filename: "hero.jpg",
    };
  }
  if (tool === "web_post") {
    return {
      url: "https://api.example.com/graphql",
      headers: { Authorization: "Bearer <token>", "Content-Type": "application/json" },
      body: '{"query":"query { __typename }"}',
    };
  }
  return {
    url: "https://api.example.com/items/example?limit=0&meta=filter_count",
    headers: { Authorization: "Bearer <token>" },
  };
}

export function detectHttpIntentInShellCommand(command: string): HttpIntentDetection {
  const cmd = String(command || "");
  const scriptBody = extractNodeEvalBody(cmd);
  const haystack = `${cmd}\n${scriptBody}`.replace(/\\n/g, "\n").replace(/\\"/g, '"');

  let kind: HttpToolKind | null = null;
  if (UPLOAD_MARKERS.test(haystack)) kind = "upload";
  else if (GRAPHQL_MARKERS.test(haystack)) kind = "graphql";
  else if (POST_MARKERS.test(haystack)) kind = "post";
  else if (GET_MARKERS.test(haystack)) kind = "get";

  const detected = kind !== null;
  const suggested_tool = pickSuggestedTool(kind || "unknown_http");
  const example_args = defaultExampleArgs(suggested_tool);

  const recovery_hint = detected
    ? `HTTP calls belong in \`${suggested_tool}\`, not run_shell. Example: ${JSON.stringify(example_args)}`
    : "";

  return { detected, kind: kind || "unknown_http", suggested_tool, recovery_hint, example_args };
}

export function formatShellHttpMisrouteError(detection: HttpIntentDetection): string {
  return (
    `run_shell (nodebox): HTTP calls belong in ${detection.suggested_tool}, not shell — ${detection.recovery_hint}`
  );
}

export function shellCommandLooksLikeHttp(command: string): boolean {
  return detectHttpIntentInShellCommand(command).detected;
}
