export type ToolImplementFn = (args: unknown, ctx?: unknown) => Promise<unknown> | unknown;

export interface BuiltinToolEntry {
  fn: ToolImplementFn;
  emoji: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation?: boolean;
  approvalSummary?: string;
}

export interface ToolCatalogEntry {
  emoji?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  requiresConfirmation?: boolean;
  approvalSummary?: string;
}

export interface ToolCallShape {
  id?: string;
  name?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
  arguments?: string | Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const BUILTIN_TOOLS: Record<string, BuiltinToolEntry>;
export const TOOLS: Record<string, ToolImplementFn>;

export function loadToolCatalog(): Promise<Record<string, ToolCatalogEntry>>;
export function getToolNamesAsync(): Promise<string[]>;
export function buildToolSpec(toolCatalog: Record<string, ToolCatalogEntry>): Promise<string>;
export function buildOpenAiToolDefinitions(
  toolCatalog: Record<string, ToolCatalogEntry>,
): Promise<OpenAiToolDefinition[]>;
export function runTools(
  toolCalls: ToolCallShape[],
  ctx?: unknown,
  toolCatalog?: Record<string, ToolCatalogEntry>,
): Promise<unknown[]>;
export function reloadToolCapabilitiesForTest(): void;
