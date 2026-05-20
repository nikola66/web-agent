/**
 * Argument validation, coercion, and schema resolution for tool calls.
 */

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
  schema?: JSONSchema | null
): Record<string, unknown> {
  if (!schema || schema.type !== "object") return rawArgs as Record<string, unknown>;

  let args: unknown = rawArgs;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};

  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const normalized = { ...(args as Record<string, unknown>) };

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
