type JsonSchema = Record<string, unknown>;

const TOP_LEVEL_FORBIDDEN_KEYS = ["allOf", "anyOf", "oneOf", "enum", "not"] as const;
const sanitizedSchemaCache = new Map<string, JsonSchema>();

export function invalidateSanitizedSchemaCache() {
  sanitizedSchemaCache.clear();
}

function schemaCacheKey(toolName: string, params: unknown) {
  return `${toolName}:${JSON.stringify(params)}`;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripTopLevelCombinators(params: JsonSchema): JsonSchema {
  const out = { ...params };
  for (const key of TOP_LEVEL_FORBIDDEN_KEYS) {
    delete out[key];
  }
  return out;
}

function stripNullableUnions(schema: unknown, keepNullableHint = true): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => stripNullableUnions(item, keepNullableHint));
  }
  if (!schema || typeof schema !== "object") return schema;

  const node = schema as JsonSchema;
  const stripped: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    stripped[key] = stripNullableUnions(value, keepNullableHint);
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = stripped[key];
    if (!Array.isArray(variants)) continue;
    const nonNull = variants.filter(
      (item) => !(item && typeof item === "object" && (item as JsonSchema).type === "null")
    );
    if (nonNull.length === 1 && nonNull.length !== variants.length) {
      const replacement =
        nonNull[0] && typeof nonNull[0] === "object" ? { ...(nonNull[0] as JsonSchema) } : {};
      if (keepNullableHint) replacement.nullable = true;
      for (const metaKey of ["title", "description", "default", "examples"] as const) {
        if (metaKey in stripped && !(metaKey in replacement)) {
          replacement[metaKey] = stripped[metaKey];
        }
      }
      return stripNullableUnions(replacement, keepNullableHint);
    }
  }
  return stripped;
}

function sanitizeNode(node: unknown): unknown {
  if (typeof node === "string") {
    if (["object", "string", "number", "integer", "boolean", "array", "null"].includes(node)) {
      return node === "object" ? { type: "object", properties: {} } : { type: node };
    }
    return { type: "object", properties: {} };
  }

  if (Array.isArray(node)) {
    return node.map((item) => sanitizeNode(item));
  }

  if (!node || typeof node !== "object") return node;

  const input = node as JsonSchema;
  const out: JsonSchema = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === "type" && Array.isArray(value)) {
      const nonNull = value.filter((t) => t !== "null");
      if (nonNull.length === 1 && typeof nonNull[0] === "string") {
        out.type = nonNull[0];
        if (value.includes("null")) out.nullable = true;
        continue;
      }
      const first = value.find((t) => typeof t === "string" && t !== "null");
      out.type = typeof first === "string" ? first : "object";
      continue;
    }

    if (
      (key === "properties" || key === "$defs" || key === "definitions") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const props: JsonSchema = {};
      for (const [subKey, subValue] of Object.entries(value as JsonSchema)) {
        props[subKey] = sanitizeNode(subValue);
      }
      out[key] = props;
      continue;
    }

    if (key === "items" || key === "additionalProperties") {
      if (typeof value === "boolean") {
        out[key] = value;
      } else {
        out[key] = sanitizeNode(value);
      }
      continue;
    }

    if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      out[key] = value.map((item) => sanitizeNode(item));
      continue;
    }

    if (key === "required" || key === "enum") {
      out[key] = Array.isArray(value) ? [...value] : value;
      continue;
    }

    if (key === "examples") {
      continue;
    }

    out[key] = value && typeof value === "object" ? sanitizeNode(value) : value;
  }

  if (out.type === "object" && !Object.prototype.hasOwnProperty.call(out, "properties")) {
    out.properties = {};
  }
  if (out.type === "array" && !Object.prototype.hasOwnProperty.call(out, "items")) {
    out.items = { type: "object", properties: {} };
  }

  if (out.type === "object" && Array.isArray(out.required) && out.properties) {
    const props = out.properties as JsonSchema;
    const valid = (out.required as unknown[]).filter(
      (name) => typeof name === "string" && name in props
    );
    if (!valid.length) delete out.required;
    else if (valid.length !== (out.required as unknown[]).length) out.required = valid;
  }

  return out;
}

function sanitizeParameters(params: unknown, toolName: string): JsonSchema {
  const cacheKey = schemaCacheKey(toolName, params);
  const cached = sanitizedSchemaCache.get(cacheKey);
  if (cached) return cached;

  if (!params || typeof params !== "object" || Array.isArray(params)) {
    const fallback = { type: "object", properties: {} };
    sanitizedSchemaCache.set(cacheKey, fallback);
    return fallback;
  }

  let sanitized = sanitizeNode(deepClone(params)) as JsonSchema;
  if (sanitized.type !== "object") sanitized = { type: "object", properties: {} };
  if (!sanitized.properties || typeof sanitized.properties !== "object") {
    sanitized.properties = {};
  }
  delete sanitized.examples;
  sanitized = stripNullableUnions(sanitized, true) as JsonSchema;
  sanitized = stripTopLevelCombinators(sanitized);
  sanitizedSchemaCache.set(cacheKey, sanitized);
  return sanitized;
}

export type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export function sanitizeToolSchemas(tools: OpenAiToolDefinition[]): OpenAiToolDefinition[] {
  if (!Array.isArray(tools) || !tools.length) return tools;
  return tools.flatMap((tool) => {
    const fn = tool?.function;
    if (!fn || typeof fn !== "object" || typeof fn.name !== "string") return [];
    return [{
      ...tool,
      function: {
        ...fn,
        parameters: sanitizeParameters(fn.parameters, fn.name),
      },
    }];
  });
}
