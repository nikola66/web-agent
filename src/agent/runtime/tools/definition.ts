export type ToolImplementFn = (args: Record<string, unknown>, ctx: unknown) => unknown;

export type ToolDefinition = {
  name: string;
  run: ToolImplementFn;
  emoji: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation?: boolean;
  approvalSummary?: string;
};

export function defineTool<T extends ToolDefinition>(tool: T): T {
  return tool;
}
