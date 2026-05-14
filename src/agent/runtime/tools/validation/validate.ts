/**
 * Argument validation and normalization.
 */

import { coerceValueBySchema, schemaAllowsNull } from "./coerce.js";

interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  examples?: unknown[];
  [key: string]: unknown;
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
