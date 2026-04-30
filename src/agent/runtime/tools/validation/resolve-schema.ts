/**
 * Input schema resolution.
 */

interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  inputSchema?: JSONSchema;
  [key: string]: unknown;
}

interface ResolvedSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
}

export function resolveInputSchema(meta?: JSONSchema | null): ResolvedSchema {
  const schema = meta?.inputSchema;
  if (schema && typeof schema === "object" && schema.type === "object") {
    return {
      type: "object",
      properties: schema.properties && typeof schema.properties === "object" ? schema.properties : {},
      required: Array.isArray(schema.required) ? schema.required : [],
      additionalProperties:
        typeof schema.additionalProperties === "boolean" ? schema.additionalProperties : false,
    };
  }
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: true,
  };
}
