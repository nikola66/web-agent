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

export function loadTools(): Promise<Record<string, ToolImplementFn>>;
export function prepareIncomingToolArguments(
  toolName: string,
  args: unknown,
  toolCatalog?: Record<string, ToolCatalogEntry>,
): Promise<{ name: string; args: Record<string, unknown> }>;
export function isParallelSafeToolCall(name: string, args?: Record<string, unknown>): boolean;
export const PARALLEL_SAFE_TOOLS: ReadonlySet<string>;
export function shouldParallelizeToolBatch(prepared: Array<{ name: string; args?: Record<string, unknown> }>): boolean;
export function buildOpenAiToolDefinitions(
  toolCatalog: Record<string, ToolCatalogEntry>,
): Promise<OpenAiToolDefinition[]>;
export function runTools(
  toolCalls: ToolCallShape[],
  ctx?: unknown,
  toolCatalog?: Record<string, ToolCatalogEntry>,
): Promise<unknown[]>;
export function reloadToolCapabilitiesForTest(): void;
