export interface BuiltinToolEntry {
  fn: Function;
  emoji: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation?: boolean;
  approvalSummary?: string;
}

export const BUILTIN_TOOLS: Record<string, BuiltinToolEntry>;
export const TOOLS: Record<string, Function>;

export function loadToolCatalog(): Promise<Record<string, any>>;
export function getToolNamesAsync(): Promise<string[]>;
export function buildToolSpec(toolCatalog: Record<string, any>): Promise<string>;
export function buildOpenAiToolDefinitions(toolCatalog: Record<string, any>): Promise<any[]>;
export function runTools(toolCalls: any[], ctx?: any, toolCatalog?: Record<string, any>): Promise<any[]>;
export function reloadToolCapabilitiesForTest(): void;
