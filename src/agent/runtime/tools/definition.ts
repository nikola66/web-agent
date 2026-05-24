export type ToolImplementFn = (args: Record<string, unknown>, ctx: unknown) => unknown;

export type ToolDefinition = {
  name: string;
  run: ToolImplementFn;
  emoji: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation?: boolean;
  approvalSummary?: string;
  llmVisible?: boolean;
  toolGroup?: string;
};

export function defineTool<T extends ToolDefinition>(tool: T): T {
  return tool;
}

export function strictObjectSchema(
  properties: Record<string, unknown>,
  required?: string[],
  examples?: Record<string, unknown>[]
): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required?.length) schema.required = required;
  if (examples?.length) schema.examples = examples;
  return schema;
}
