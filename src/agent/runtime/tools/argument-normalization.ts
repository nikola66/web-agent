/**
 * Argument validation, coercion, and schema resolution for tool calls.
 */

import { WORKSPACE_LABEL } from "../constants.js";

interface JSONSchema {
  type?: string | string[];
  nullable?: boolean;
  properties?: Record<string, unknown>;
  required?: string[];
  examples?: unknown[];
  additionalProperties?: boolean;
  inputSchema?: JSONSchema;
  [key: string]: unknown;
}

interface ResolvedSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
  /** Passed through to OpenAI-style `parameters` when present (JSON Schema `examples`). */
  examples?: unknown[];
}

export function schemaAllowsNull(schema: unknown): schema is JSONSchema {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as Record<string, unknown>;
  if (s.type === "null") return true;
  if (Array.isArray(s.type) && s.type.includes("null")) return true;
  if (s.nullable === true) return true;
  return false;
}

function coerceBoolean(value: unknown): boolean | unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "n" || normalized === "0") return false;
  return value;
}

function coerceNumber(value: unknown, integerOnly = false): number | unknown {
  if (typeof value !== "string") return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  if (integerOnly && !Number.isInteger(parsed)) return value;
  return integerOnly ? Math.trunc(parsed) : parsed;
}

function stripTrailingCommas(jsonText: string): string {
  return jsonText.replace(/,\s*([}\]])/g, "$1");
}

function closeUnclosedJsonDelimiters(jsonText: string): string {
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;
  for (const ch of jsonText) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") openBraces += 1;
    else if (ch === "}") openBraces -= 1;
    else if (ch === "[") openBrackets += 1;
    else if (ch === "]") openBrackets -= 1;
  }
  let out = jsonText;
  while (openBrackets > 0) {
    out += "]";
    openBrackets -= 1;
  }
  while (openBraces > 0) {
    out += "}";
    openBraces -= 1;
  }
  return out;
}

function stripExcessClosingDelimiters(jsonText: string): string {
  let out = jsonText;
  for (let i = 0; i < 8; i += 1) {
    try {
      JSON.parse(out);
      return out;
    } catch {
      if (out.endsWith("}")) out = out.slice(0, -1);
      else if (out.endsWith("]")) out = out.slice(0, -1);
      else break;
    }
  }
  return out;
}

function escapeControlCharsInJsonStrings(jsonText: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < jsonText.length; i += 1) {
    const ch = jsonText[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch.charCodeAt(0) < 0x20) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      else out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Hermes-style repair for raw tool argument JSON strings (truncation, trailing commas, etc.).
 * Returns canonical JSON text; last resort is "{}".
 */
export function repairToolCallArgumentsJson(raw: unknown, _toolName?: string): string {
  if (raw == null) return "{}";
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return "{}";
    }
  }
  let text = String(raw).trim();
  if (!text || /^none$/i.test(text)) return "{}";

  const attempts = [
    () => text,
    () => stripTrailingCommas(text),
    () => closeUnclosedJsonDelimiters(stripTrailingCommas(text)),
    () => stripExcessClosingDelimiters(closeUnclosedJsonDelimiters(stripTrailingCommas(text))),
    () =>
      escapeControlCharsInJsonStrings(
        closeUnclosedJsonDelimiters(stripTrailingCommas(text))
      ),
  ];

  for (const build of attempts) {
    try {
      const candidate = build();
      const parsed = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === "object") {
        return JSON.stringify(parsed);
      }
    } catch {
      /* try next stage */
    }
  }
  return "{}";
}

/**
 * Repair model-emitted pseudo tool objects (`call:tool{"name="find_find_files"arguments={...}`).
 */
function extractBalancedJsonObject(text: string, startIdx: number): string {
  const start = text.indexOf("{", startIdx);
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

export function repairLooseToolCallObject(raw: unknown): { name: string; arguments: Record<string, unknown> } | null {
  let text = String(raw ?? "").trim();
  if (!text) return null;
  text = text.replace(/^call:\s*tool\s*/i, "").trim();
  if (!text.startsWith("{")) return null;

  const nameFromWire =
    text.match(/(?:name|tool)\s*[=:]\s*"?([a-z][a-z0-9_]{1,48})"?/i)?.[1] || "";
  const argsKey = text.search(/\b(?:arguments|args)\s*[=:]/i);
  const argsWire =
    argsKey >= 0 ? extractBalancedJsonObject(text, argsKey) : "";

  let repaired = text
    .replace(/\b(name|tool|arguments|args)\s*=\s*/gi, '"$1":')
    .replace(/"name"\s*:\s*([a-z][a-z0-9_]{1,48})(?=[,}\s])/gi, '"name":"$1"')
    .replace(/"tool"\s*:\s*([a-z][a-z0-9_]{1,48})(?=[,}\s])/gi, '"tool":"$1"')
    .replace(/"([^"]+)"\s*"(arguments|args)"/gi, '"$1","$2"');

  const attempts = [repaired, text];
  for (const candidate of attempts) {
    try {
      const wire = repairToolCallArgumentsJson(candidate);
      const parsed = JSON.parse(wire);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const row = parsed as Record<string, unknown>;
      const fn = row.function as Record<string, unknown> | undefined;
      const name = String(row.name || row.tool || fn?.name || nameFromWire || "").trim();
      if (!name) continue;
      let args = fn?.arguments ?? row.arguments ?? row.args ?? {};
      if (typeof args === "string") args = parseToolArguments(args, name);
      if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
      if (!Object.keys(args as object).length && argsWire) {
        args = parseToolArguments(argsWire, name);
      }
      return { name, arguments: repairMalformedToolArguments(args as Record<string, unknown>) };
    } catch {
      /* try next */
    }
  }

  if (!nameFromWire) return null;
  const args = argsWire ? parseToolArguments(argsWire, nameFromWire) : {};
  return { name: nameFromWire, arguments: args };
}

/** Parse wire or object tool args into a plain object (with key/value unquoting). */
export function parseToolArguments(raw: unknown, toolName?: string): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return repairMalformedToolArguments(raw as Record<string, unknown>);
  }
  if (typeof raw === "string") {
    const wire = repairToolCallArgumentsJson(raw, toolName);
    try {
      const parsed = JSON.parse(wire);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return repairMalformedToolArguments(parsed as Record<string, unknown>);
      }
    } catch {
      return {};
    }
    return {};
  }
  return {};
}

function coerceJson(value: unknown, expectedType: string): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    if (expectedType === "array" && Array.isArray(parsed)) return parsed;
    if (expectedType === "object" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    /* keep as string */
  }
  return value;
}

export function coerceValueBySchema(value: unknown, propertySchema?: JSONSchema | null): unknown {
  const expected = propertySchema?.type;
  if (typeof value === "string" && schemaAllowsNull(propertySchema) && value.trim().toLowerCase() === "null") {
    return null;
  }
  if (Array.isArray(expected)) {
    let current: unknown = value;
    for (const branchType of expected) {
      const next = coerceValueBySchema(current, { ...propertySchema, type: branchType });
      if (next !== current) return next;
    }
    return current;
  }
  if (expected === "integer") return coerceNumber(value, true);
  if (expected === "number") return coerceNumber(value, false);
  if (expected === "boolean") return coerceBoolean(value);
  if (expected === "array") {
    const parsed = coerceJson(value, "array");
    if (parsed !== value) return parsed;
    if (value !== undefined && value !== null && !Array.isArray(value)) return [value];
    return value;
  }
  if (expected === "object") return coerceJson(value, "object");
  return value;
}

function normalizeArgumentKey(key: string): string {
  let k = String(key ?? "").trim();
  if (!k) return "";
  k = k.replace(/\\/g, "");
  while (k.length >= 2 && /^["']/.test(k) && /["']$/.test(k)) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

function normalizeArgumentStringValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let v = value.trim();
  while (v.length >= 2 && /^["']/.test(v) && /["']$/.test(v)) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function keyRepairWeight(key: string): number {
  const raw = String(key ?? "");
  return (raw.match(/["'\\]/g) || []).length;
}

/** Fix models that quote JSON keys/values (`"query"` instead of query). */
export function repairMalformedToolArguments(
  args: Record<string, unknown>
): Record<string, unknown> {
  const entries = Object.entries(args).filter(([key]) => normalizeArgumentKey(key));
  entries.sort((a, b) => keyRepairWeight(b[0]) - keyRepairWeight(a[0]));
  const repaired: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const cleanKey = normalizeArgumentKey(key);
    repaired[cleanKey] = normalizeArgumentStringValue(value);
  }
  return repaired;
}

const WORKSPACE_BROWSE_PATH_TOOLS = new Set([
  "list_dir",
  "find_files",
  "grep",
  "tree",
  "read_file",
  "write_file",
  "make_dir",
  "edit_file",
  "multi_edit",
  "delete_file",
]);

/** Map `/`, empty, or `/workspace` to workspace root `.` before path resolution. */
export function coerceWorkspaceBrowsePath(input: unknown): string {
  const raw = String(input ?? ".").trim();
  if (!raw || raw === "/" || raw === "\\") return ".";
  if (raw === WORKSPACE_LABEL || raw === `${WORKSPACE_LABEL}/`) return ".";
  return raw;
}

export function sanitizeFindFilesPatternToken(raw: string): string {
  const t = String(raw ?? "").trim();
  if (/^\*[^*?]+\*$/.test(t)) return t.slice(1, -1);
  return t;
}

export function normalizeFindFilePatterns({
  pattern,
  query,
  patterns,
}: {
  pattern?: unknown;
  query?: unknown;
  patterns?: unknown;
}): string[] {
  const sanitize = (parts: string[]) => parts.map(sanitizeFindFilesPatternToken).filter(Boolean);
  if (Array.isArray(patterns)) {
    const fromArray = patterns
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
    if (fromArray.length) return sanitize(fromArray);
  }
  const single = String(pattern ?? query ?? "").trim();
  if (!single) return [];
  if (!/[*?]/.test(single) && single.includes(",")) {
    return sanitize(
      single
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    );
  }
  return sanitize([single]);
}

function resolveFindFilesMatchMode(
  matchMode: unknown,
  patternCount: number
): "all" | "any" | "single" {
  const mode = String(matchMode ?? "").trim().toLowerCase();
  if (mode === "any" || mode === "or") return "any";
  if (patternCount <= 1) return "single";
  return "all";
}

/** Map mistaken `query` (session_search habit) to `pattern` for grep. */
export function coerceGrepArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  const pattern = String(out.pattern ?? "").trim();
  const query = String(out.query ?? "").trim();
  if (!pattern && query) {
    out.pattern = query;
    delete out.query;
  }
  return out;
}

export function coerceFindFilesArguments(
  args: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...args };
  const resolved = normalizeFindFilePatterns(out);
  const matchMode = resolveFindFilesMatchMode(out.matchMode, resolved.length);
  if (resolved.length) {
    out.patterns = resolved;
    if (resolved.length === 1) out.pattern = resolved[0];
  }
  out.matchMode = matchMode;
  return out;
}

export function applyWorkspaceBrowsePathArgs(
  toolName: string,
  argsObj: Record<string, unknown>
): Record<string, unknown> {
  if (!WORKSPACE_BROWSE_PATH_TOOLS.has(toolName) || !argsObj || typeof argsObj !== "object") {
    return argsObj;
  }
  const out = { ...argsObj };
  if ("path" in out) out.path = coerceWorkspaceBrowsePath(out.path);
  if ("root" in out) out.root = coerceWorkspaceBrowsePath(out.root);
  return out;
}

const WIKI_PATH_TOOLS = new Set(["wiki_setup", "wiki_sync", "wiki_search"]);

const SKILL_NAME_ARG_TOOLS = new Set(["skill_view", "skill_manage"]);

/** Models often send `slug`; schema requires `name`. */
export function applySkillNameArgAliases(
  toolName: string,
  argsObj: Record<string, unknown>
): Record<string, unknown> {
  if (!SKILL_NAME_ARG_TOOLS.has(toolName) || !argsObj || typeof argsObj !== "object") {
    return argsObj;
  }
  const out = { ...argsObj };
  const name = typeof out.name === "string" ? out.name.trim() : "";
  const slug = typeof out.slug === "string" ? out.slug.trim() : "";
  if (!name && slug) out.name = slug;
  if ("slug" in out) delete out.slug;
  return out;
}

export function applyWikiPathArgs(
  toolName: string,
  argsObj: Record<string, unknown>
): Record<string, unknown> {
  if (!WIKI_PATH_TOOLS.has(toolName) || !argsObj || typeof argsObj !== "object") {
    return argsObj;
  }
  const out = { ...argsObj };
  const rootPath = typeof out.root_path === "string" ? out.root_path.trim() : "";
  const path = typeof out.path === "string" ? out.path.trim() : "";
  if (!rootPath && path) out.root_path = coerceWorkspaceBrowsePath(path);
  else if (rootPath) out.root_path = coerceWorkspaceBrowsePath(rootPath);
  return out;
}

export function validateRequiredArguments(
  toolName: string,
  args: unknown,
  schema?: JSONSchema | null
): string | null {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (!required.length) return null;

  const argsObj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const missing = required.filter((key) => {
    if (!(key in argsObj)) return true;
    return argsObj[key] === undefined;
  });

  if (!missing.length) return null;
  let hint = "";
  if (
    SKILL_NAME_ARG_TOOLS.has(toolName) &&
    typeof argsObj.slug === "string" &&
    String(argsObj.slug).trim() &&
    !String(argsObj.name || "").trim()
  ) {
    hint = ' Use JSON key `name` (not `slug`), e.g. {"name":"http-api"}.';
  }
  const ex = schema?.examples;
  if (Array.isArray(ex) && ex.length && ex[0] && typeof ex[0] === "object") {
    try {
      hint = ` Example: ${JSON.stringify(ex[0])}`;
    } catch {
      /* ignore */
    }
  }
  return `invalid arguments: missing required field(s) [${missing.join(
    ", "
  )}] for ${toolName}. Provide all required fields from the tool schema.${hint}`;
}

export function normalizeToolArguments(
  rawArgs: unknown,
  schema?: JSONSchema | null,
  toolName?: string
): Record<string, unknown> {
  if (!schema || schema.type !== "object") {
    return parseToolArguments(rawArgs, toolName);
  }

  const repaired = parseToolArguments(rawArgs, toolName);

  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const normalized = { ...repaired };

  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in normalized)) continue;
    normalized[key] = coerceValueBySchema(normalized[key], propSchema as JSONSchema | null);
  }

  for (const key of Object.keys(normalized)) {
    if (normalized[key] === undefined) {
      delete normalized[key];
      continue;
    }
    const propSchema = properties[key] as JSONSchema | null | undefined;
    if (
      normalized[key] === null &&
      !required.has(key) &&
      propSchema &&
      !schemaAllowsNull(propSchema)
    ) {
      delete normalized[key];
    }
  }

  if (toolName === "find_files") {
    return applyWorkspaceBrowsePathArgs(toolName, coerceFindFilesArguments(normalized));
  }
  if (toolName === "grep") {
    return applyWorkspaceBrowsePathArgs(toolName, coerceGrepArguments(normalized));
  }
  if (toolName) {
    return applyWorkspaceBrowsePathArgs(toolName, normalized);
  }
  return normalized;
}

export function resolveInputSchema(meta?: JSONSchema | null): ResolvedSchema {
  const schema = meta?.inputSchema;
  if (schema && typeof schema === "object" && schema.type === "object") {
    const resolved: ResolvedSchema = {
      type: "object",
      properties: schema.properties && typeof schema.properties === "object" ? schema.properties : {},
      required: Array.isArray(schema.required) ? schema.required : [],
      additionalProperties:
        typeof schema.additionalProperties === "boolean" ? schema.additionalProperties : false,
    };
    const ex = (schema as { examples?: unknown }).examples;
    if (Array.isArray(ex)) resolved.examples = ex;
    return resolved;
  }
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: true,
  };
}
