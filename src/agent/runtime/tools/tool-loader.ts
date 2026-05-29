import fs from "node:fs/promises";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { CAPABILITIES_DIR, WS } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { errorMessage } from "../utils.js";
import { BUILTIN_TOOL_DEFINITIONS } from "./builtins/index.js";
import type { ToolDefinition, ToolImplementFn } from "./definition.js";
import { resolveToolVisibility } from "./tool-visibility.js";
import { resolveInputSchema } from "./argument-normalization.js";
import { invalidateSanitizedSchemaCache, sanitizeToolSchemas } from "../llm/tool-schema-sanitizer.js";
import {
  clearMcpToolsCache,
  discoverAndRegisterMcpTools,
  getMcpCatalogCache,
  getMcpToolsCache,
} from "../mcp-registry.js";

type CapabilityCatalogEntry = {
  id: string;
  emoji: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation: boolean;
  order?: number;
};

function isValidToolName(name) {
  return /^[a-z][a-z0-9_]*$/.test(String(name || ""));
}

function toBuiltinEntry(def: ToolDefinition) {
  const visibility = resolveToolVisibility(def.name, def);
  return {
    fn: def.run,
    emoji: def.emoji,
    description: def.description,
    inputSchema: def.inputSchema,
    ...(def.requiresConfirmation !== undefined ? { requiresConfirmation: def.requiresConfirmation } : {}),
    ...(def.approvalSummary !== undefined ? { approvalSummary: def.approvalSummary } : {}),
    ...(def.llmVisible === false ? { llmVisible: false } : {}),
    ...(def.toolGroup !== undefined ? { toolGroup: def.toolGroup } : {}),
    visibility,
  };
}

function buildBuiltinTools(definitions: readonly ToolDefinition[]) {
  const seen = new Set<string>();
  return Object.fromEntries(definitions.map((def) => {
    if (!isValidToolName(def.name)) throw new Error(`Invalid built-in tool name: ${def.name}`);
    if (seen.has(def.name)) throw new Error(`Duplicate built-in tool name: ${def.name}`);
    seen.add(def.name);
    return [def.name, toBuiltinEntry(def)];
  }));
}

export const BUILTIN_TOOLS = buildBuiltinTools(BUILTIN_TOOL_DEFINITIONS);

let capabilityToolsCache: Record<string, ToolImplementFn> | null = null;
let toolsCache: Record<string, ToolImplementFn> | null = null;
let capabilityToolCatalogCache: Record<string, CapabilityCatalogEntry> | null = null;

function capabilityToolRoots() {
  return [
    nodePath.join(CAPABILITIES_DIR, "tools"),
    nodePath.join(WS, "src", "capabilities", "tools"),
  ];
}

function normalizeToolManifest(
  manifest: unknown,
  fallbackId: string
): CapabilityCatalogEntry | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const m = manifest as Record<string, unknown>;
  const id = String(m.id || fallbackId || "").trim();
  if (!isValidToolName(id)) return null;
  const schema =
    m.inputSchema && typeof m.inputSchema === "object" && !Array.isArray(m.inputSchema)
      ? (m.inputSchema as Record<string, unknown>)
      : { type: "object", additionalProperties: true };
  return {
    id,
    emoji: String(m.emoji || "🧩"),
    description: String(m.description || `Invoke the ${id} capability.`),
    inputSchema: schema,
    requiresConfirmation: Boolean(m.requiresConfirmation),
    order: Number.isFinite(Number(m.order)) ? Number(m.order) : undefined,
  };
}

async function loadCapabilityTools(): Promise<{
  tools: Record<string, ToolImplementFn>;
  catalog: Record<string, CapabilityCatalogEntry>;
}> {
  if (capabilityToolsCache && capabilityToolCatalogCache) {
    return { tools: capabilityToolsCache, catalog: capabilityToolCatalogCache };
  }
  const tools: Record<string, ToolImplementFn> = {};
  const catalog: Record<string, CapabilityCatalogEntry> = {};
  for (const root of capabilityToolRoots()) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = nodePath.join(root, entry.name);
    const manifestPath = nodePath.join(dir, "manifest.json");
    const handlerPath = nodePath.join(dir, "handler.js");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const manifest = normalizeToolManifest(JSON.parse(raw), entry.name);
      if (!manifest) {
        await logDebugEvent("capability_tool_skipped", {
          folder: entry.name,
          reason: "invalid manifest",
        });
        continue;
      }
      const stat = await fs.stat(handlerPath).catch(() => null);
      if (!stat?.isFile()) {
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "missing handler.js",
        });
        continue;
      }
      if (BUILTIN_TOOLS[manifest.id]) {
        console.warn(`[tools] capability "${manifest.id}" shadows built-in; skipped (${dir})`);
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "duplicate built-in tool",
        });
        continue;
      }
      if (tools[manifest.id]) {
        console.warn(`[tools] capability "${manifest.id}" already loaded; skipped (${dir})`);
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "duplicate capability tool",
        });
        continue;
      }
      const mod = await import(/* @vite-ignore */ `${pathToFileURL(handlerPath).href}?v=${stat.mtimeMs}`);
      const fn = typeof mod.run === "function" ? mod.run : mod.default;
      if (typeof fn !== "function") {
        await logDebugEvent("capability_tool_skipped", {
          tool: manifest.id,
          reason: "handler does not export run/default",
        });
        continue;
      }
      tools[manifest.id] = fn as ToolImplementFn;
      catalog[manifest.id] = manifest;
    } catch (err) {
      await logDebugEvent("capability_tool_error", {
        folder: entry.name,
        error: errorMessage(err),
      });
    }
    }
  }
  capabilityToolsCache = tools;
  capabilityToolCatalogCache = catalog;
  return { tools, catalog };
}

export async function loadTools(): Promise<Record<string, ToolImplementFn>> {
  if (toolsCache) return toolsCache;
  const { tools: capabilityTools } = await loadCapabilityTools();

  // Extract functions from BUILTIN_TOOLS (which have { fn, emoji, description, ... } structure)
  const builtinFunctions: Record<string, ToolImplementFn> = Object.fromEntries(
    Object.entries(BUILTIN_TOOLS).map(([name, entry]) => [
      name,
      (typeof entry === "function" ? entry : entry.fn) as ToolImplementFn,
    ])
  );

  const mcpEntries = Object.entries(getMcpToolsCache()).flatMap(([name, entry]) => {
    if (BUILTIN_TOOLS[name] || capabilityTools[name]) {
      console.warn(`[tools] MCP tool "${name}" shadows built-in/capability; skipped`);
      return [];
    }
    if (!isValidToolName(name)) {
      console.warn(`[tools] MCP tool "${name}" has invalid name; skipped`);
      return [];
    }
    return [[name, entry.fn] as const];
  });

  toolsCache = {
    ...builtinFunctions,
    ...capabilityTools,
    ...Object.fromEntries(mcpEntries),
  };
  return toolsCache;
}

export function bustToolsCacheForMcp() {
  toolsCache = null;
  void import("../tool-capability-index.js").then((m) => m.invalidateToolCapabilityIndexCache?.());
}

export async function reloadMcpTools() {
  invalidateSanitizedSchemaCache();
  await discoverAndRegisterMcpTools({ unlockForSession: true });
  void import("../turn.js").then((m) => m.invalidateToolNamesCache?.());
}

export function reloadToolCapabilitiesForTest() {
  capabilityToolsCache = null;
  capabilityToolCatalogCache = null;
  toolsCache = null;
  clearMcpToolsCache();
  invalidateSanitizedSchemaCache();
}

export async function getToolNamesAsync() {
  return Object.keys(await loadTools());
}

export async function loadToolCatalog() {
  const { catalog: capabilityCatalog } = await loadCapabilityTools();
  const builtinCatalog = Object.fromEntries(
    Object.entries(BUILTIN_TOOLS).flatMap(([name, entry]) => {
      if (typeof entry === "function") return [];
      return [[
        name,
        {
          emoji: entry.emoji,
          description: entry.description,
          inputSchema: entry.inputSchema as Record<string, unknown>,
          ...(entry.requiresConfirmation !== undefined ? { requiresConfirmation: entry.requiresConfirmation } : {}),
          ...(entry.approvalSummary !== undefined ? { approvalSummary: entry.approvalSummary } : {}),
          ...(entry.llmVisible === false ? { llmVisible: false } : {}),
          ...(entry.toolGroup !== undefined ? { toolGroup: entry.toolGroup } : {}),
          visibility: resolveToolVisibility(name, entry),
        },
      ]];
    })
  );
  const mcpCatalog = Object.fromEntries(
    Object.entries(getMcpCatalogCache()).flatMap(([name, entry]) => {
      if (BUILTIN_TOOLS[name] || capabilityCatalog[name] || !isValidToolName(name)) return [];
      return [[name, { emoji: entry.emoji, description: entry.description, inputSchema: entry.inputSchema, visibility: "deferred" as const }]];
    })
  );
  return {
    ...builtinCatalog,
    ...capabilityCatalog,
    ...mcpCatalog,
  };
}

export async function buildOpenAiToolDefinitions(toolCatalog) {
  const definitions = Object.keys(toolCatalog || {}).flatMap((name) => {
    const meta = toolCatalog?.[name] || null;
    if (resolveToolVisibility(name, meta) !== "active") return [];
    const schema = resolveInputSchema(meta);
    if (!schema || typeof schema !== "object" || schema.type !== "object") return [];
    const description =
      String(meta?.description || "").trim() || `Invoke the ${name} tool.`;
    return [{
      type: "function",
      function: {
        name,
        description,
        parameters: schema,
      },
    }];
  });
  return sanitizeToolSchemas(definitions);
}
