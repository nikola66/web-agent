function rewriteLocalRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteLocalRefs);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    const outKey = key === "definitions" ? "$defs" : key;
    out[outKey] = rewriteLocalRefs(value);
  }
  const ref = out.$ref;
  if (typeof ref === "string" && ref.startsWith("#/definitions/")) {
    out.$ref = `#/$defs/${ref.slice("#/definitions/".length)}`;
  }
  return out;
}

function stripNullableUnion(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNullableUnion);
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const anyOf = obj.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const nonNull = anyOf.find(
      (item) => !(item && typeof item === "object" && (item as Record<string, unknown>).type === "null")
    );
    if (nonNull) {
      const merged: Record<string, unknown> =
        nonNull && typeof nonNull === "object"
          ? { ...(nonNull as Record<string, unknown>) }
          : { type: "string" };
      if (obj.default === null || obj.default === undefined) {
        merged.nullable = true;
      }
      if (typeof obj.description === "string") merged.description = obj.description;
      return stripNullableUnion(merged);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = stripNullableUnion(value);
  }
  return out;
}

function repairObjectShape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(repairObjectShape);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const repaired: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    repaired[key] = repairObjectShape(value);
  }
  if (!repaired.type && ("properties" in repaired || "required" in repaired)) {
    repaired.type = "object";
  }
  if (repaired.type === "object") {
    if (!repaired.properties || typeof repaired.properties !== "object") {
      repaired.properties = {};
    }
    const required = repaired.required;
    if (Array.isArray(required)) {
      const props = repaired.properties as Record<string, unknown>;
      const valid = required.filter((r) => typeof r === "string" && r in props);
      if (valid.length) repaired.required = valid;
      else delete repaired.required;
    }
  }
  return repaired;
}

export function normalizeMcpInputSchema(schema: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  let normalized = rewriteLocalRefs(schema) as Record<string, unknown>;
  normalized = stripNullableUnion(normalized) as Record<string, unknown>;
  normalized = repairObjectShape(normalized) as Record<string, unknown>;
  if (normalized.type === "object" && !normalized.properties) {
    normalized = { ...normalized, properties: {} };
  }
  return normalized;
}
