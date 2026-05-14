/**
 * Coerce common LLM argument shapes before per-tool logic and JSON Schema validation.
 *
 * Some models wrap payloads like OpenAI function metadata: `{ "arguments": { ... }, ... }`.
 * That is wrong for single-tool calls but valid for `cron_register`, where top-level
 * `tool` + `arguments` are the real job contract — never hoist for that tool name.
 *
 * @see prepareToolCall in registry.ts
 * @see tool-hardening-priority.ts
 */

const NEVER_HOIST_NESTED_ARGUMENTS = new Set(["cron_register"]);

/**
 * Merge one level of `{ arguments: inner, ...rest }` into `{ ...inner, ...rest }`, recursively.
 * Outer keys win on collision. No-op if `arguments` is missing or not a plain object.
 */
export function hoistNestedToolArguments(toolName: string, raw: unknown): unknown {
  if (NEVER_HOIST_NESTED_ARGUMENTS.has(toolName)) return raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const inner = o.arguments;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return raw;
  const { arguments: _drop, ...rest } = o;
  return hoistNestedToolArguments(toolName, { ...inner, ...rest });
}
