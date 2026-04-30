/**
 * Argument coercion by JSON schema type.
 */

interface JSONSchema {
  type?: string | string[];
  nullable?: boolean;
  [key: string]: unknown;
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
