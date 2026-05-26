import { amber, dim, green, red } from "./terminal-format.js";
import {
  loadMcpServersConfig,
  removeMcpServer,
  upsertMcpServer,
  type McpServerConfig,
} from "./mcp-config.js";
import { mcpProbeServer, mcpReload, mcpShutdown, discoverAndRegisterMcpTools, formatMcpStartupBanner } from "./mcp-registry.js";
import { reloadMcpTools } from "./tools/registry.js";

function printLine(msg: string, emit?: (msg: string) => void | Promise<void>) {
  if (emit) void Promise.resolve(emit(msg));
  else console.log(msg);
}

export function parseMcpUseInput(input: string): {
  name: string;
  url: string;
  headers: Record<string, string>;
} | null {
  const trimmed = String(input || "").trim();
  if (!trimmed.startsWith("/mcp use")) return null;
  const afterUse = trimmed.slice("/mcp use".length).trim();
  const urlMatch = afterUse.match(/https?:\/\/[^\s"'<>]+/i);
  if (!urlMatch) return null;
  const url = urlMatch[0].replace(/[.,;:!?)]+$/, "");
  const headers: Record<string, string> = {};
  let name = "";
  const tokens = afterUse.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--name" && tokens[i + 1]) {
      name = tokens[++i];
      continue;
    }
    if (token === "--header" && tokens[i + 1]) {
      let raw = tokens[++i];
      while (i + 1 < tokens.length && !tokens[i + 1].startsWith("--")) {
        raw += ` ${tokens[++i]}`;
      }
      const eq = raw.indexOf("=");
      if (eq > 0) {
        const k = raw.slice(0, eq).trim();
        if (k) headers[k] = raw.slice(eq + 1);
      }
    }
  }
  if (!name) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/\./g, "-");
      const path = u.pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
      name = (path ? `${host}-${path}` : host).replace(/[^a-zA-Z0-9_-]/g, "") || "mcp-remote";
    } catch {
      name = "mcp-remote";
    }
  }
  return { name, url, headers };
}

function mcpAuthHeadersFromEnv(): Record<string, string> {
  if (typeof process === "undefined" || !process.env) return {};
  const token = String(
    process.env.DIRECTUS_TOKEN ||
      process.env.DIRECTUS_API_TOKEN ||
      process.env.DIRECTUS_ACCESS_TOKEN ||
      ""
  ).trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function parseMcpAddArgs(input: string): {
  name: string;
  url?: string;
  command?: string;
  args: string[];
  include: string[];
  env: Record<string, string>;
  transport?: "sse";
  headers?: Record<string, string>;
} | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length < 3 || parts[0] !== "/mcp" || parts[1] !== "add") return null;
  const name = parts[2];
  let url: string | undefined;
  let command: string | undefined;
  const cmdArgs: string[] = [];
  const include: string[] = [];
  const env: Record<string, string> = {};
  let transport: "sse" | undefined;
  const headers: Record<string, string> = {};
  for (let i = 3; i < parts.length; i++) {
    const token = parts[i];
    if (token === "--url" && parts[i + 1]) {
      url = parts[++i];
      continue;
    }
    if (token === "--command" && parts[i + 1]) {
      command = parts[++i];
      continue;
    }
    if (token === "--transport" && parts[i + 1] === "sse") {
      transport = "sse";
      i += 1;
      continue;
    }
    if (token === "--args") {
      while (parts[i + 1] && !parts[i + 1].startsWith("--")) cmdArgs.push(parts[++i]);
      continue;
    }
    if (token === "--include" && parts[i + 1]) {
      include.push(
        ...parts[++i]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      continue;
    }
    if (token === "--env" && parts[i + 1]?.includes("=")) {
      const [k, ...rest] = parts[++i].split("=");
      if (k) env[k] = rest.join("=");
      continue;
    }
    if (token === "--header" && parts[i + 1]?.includes("=")) {
      const [k, ...rest] = parts[++i].split("=");
      if (k) headers[k] = rest.join("=");
      continue;
    }
  }
  return { name, url, command, args: cmdArgs, include, env, transport, headers };
}

function transportLabel(cfg: McpServerConfig): string {
  if (cfg.url) {
    const u = cfg.url.length > 28 ? `${cfg.url.slice(0, 25)}...` : cfg.url;
    return u;
  }
  if (cfg.command) {
    const args = Array.isArray(cfg.args) ? cfg.args.slice(0, 2).join(" ") : "";
    const text = args ? `${cfg.command} ${args}` : cfg.command;
    return text.length > 28 ? `${text.slice(0, 25)}...` : text;
  }
  return "?";
}

function toolsFilterLabel(cfg: McpServerConfig): string {
  const tools = cfg.tools || {};
  if (Array.isArray(tools.include) && tools.include.length) return `${tools.include.length} selected`;
  if (Array.isArray(tools.exclude) && tools.exclude.length) return `-${tools.exclude.length} excluded`;
  return "all";
}

export async function runMcpSlashCommand(
  input: string,
  emit?: (msg: string) => void | Promise<void>
): Promise<boolean> {
  const trimmed = String(input || "").trim();
  if (trimmed === "/reload-mcp" || trimmed === "/reload_mcp") {
    try {
      const resp = (await mcpReload()) as {
        ok?: boolean;
        diff?: { added?: string[]; removed?: string[]; reconnected?: string[]; failed?: Array<{ name: string; error: string }> };
        status?: { toolCount?: number; failed?: number };
        error?: string;
      };
      if (resp?.ok === false) throw new Error(String(resp.error || "reload failed"));
      await reloadMcpTools();
      const diff = resp.diff || {};
      printLine(dim("Reloading MCP servers…"), emit);
      if (diff.added?.length) printLine(green(`  + added: ${diff.added.join(", ")}`), emit);
      if (diff.removed?.length) printLine(amber(`  - removed: ${diff.removed.join(", ")}`), emit);
      if (diff.reconnected?.length) printLine(green(`  ↻ reconnected: ${diff.reconnected.join(", ")}`), emit);
      for (const row of diff.failed || []) {
        printLine(red(`  ✗ ${row.name}: ${row.error}`), emit);
      }
      const status = resp.status || {};
      const toolCount = status.toolCount ?? 0;
      const failed = status.failed ?? 0;
      printLine(
        dim(`MCP: ${toolCount} tool(s) registered${failed ? ` (${failed} server(s) failed)` : ""}.\n`),
        emit
      );
    } catch (err) {
      printLine(red(`MCP reload failed: ${err instanceof Error ? err.message : String(err)}\n`), emit);
    }
    return true;
  }

  if (trimmed === "/mcp" || trimmed.startsWith("/mcp ")) {
    const sub = trimmed === "/mcp" ? "" : trimmed.slice("/mcp ".length).trim();
    if (!sub || sub === "help") {
      printLine(dim("MCP commands:"), emit);
      printLine(dim("  /mcp list"), emit);
      printLine(dim("  /mcp use <url> [--name <id>] [--header Key=Val]  (quick-add Streamable HTTP)"), emit);
      printLine(dim("  /mcp add <name> --url <endpoint> [--transport sse] [--include a,b]"), emit);
      printLine(dim("  /mcp add <name> --command <cmd> --args ... [--env KEY=VAL]"), emit);
      printLine(dim("  /mcp remove <name>"), emit);
      printLine(dim("  /mcp test <name>"), emit);
      printLine(dim("  /reload-mcp"), emit);
      printLine("", emit);
      return true;
    }

    if (sub === "list" || sub === "ls") {
      const servers = await loadMcpServersConfig();
      const names = Object.keys(servers);
      if (!names.length) {
        printLine(dim("No MCP servers configured.\n"), emit);
        return true;
      }
      printLine(dim("  MCP Servers:"), emit);
      printLine(dim(`  ${"Name".padEnd(16)} ${"Transport".padEnd(30)} ${"Tools".padEnd(12)} Status`), emit);
      for (const name of names.sort()) {
        const cfg = servers[name];
        const enabled = cfg.enabled !== false;
        printLine(
          `  ${name.padEnd(16)} ${transportLabel(cfg).padEnd(30)} ${toolsFilterLabel(cfg).padEnd(12)} ${
            enabled ? green("enabled") : dim("disabled")
          }`,
          emit
        );
      }
      printLine("", emit);
      return true;
    }

    if (sub.startsWith("remove ") || sub.startsWith("rm ")) {
      const name = sub.replace(/^(remove|rm)\s+/, "").trim();
      if (!name) {
        printLine(red("Usage: /mcp remove <name>\n"), emit);
        return true;
      }
      const removed = await removeMcpServer(name);
      if (!removed) printLine(red(`Server '${name}' not found.\n`), emit);
      else printLine(green(`Removed '${name}' from config.\n`), emit);
      return true;
    }

    if (sub.startsWith("test ")) {
      const name = sub.slice("test ".length).trim();
      if (!name) {
        printLine(red("Usage: /mcp test <name>\n"), emit);
        return true;
      }
      try {
        const resp = (await mcpProbeServer(name)) as {
          ok?: boolean;
          tools?: Array<{ name: string; description?: string }>;
          error?: string;
        };
        if (resp?.ok === false) throw new Error(String(resp.error || "probe failed"));
        const tools = resp.tools || [];
        if (!tools.length) printLine(amber(`Connected but no tools reported for '${name}'.\n`), emit);
        else {
          printLine(green(`✓ ${name}: ${tools.length} tool(s)`), emit);
          for (const tool of tools) {
            const desc = String(tool.description || "").slice(0, 60);
            printLine(`    ${tool.name}${desc ? ` — ${desc}` : ""}`, emit);
          }
          printLine("", emit);
        }
      } catch (err) {
        printLine(red(`Test failed: ${err instanceof Error ? err.message : String(err)}\n`), emit);
      }
      return true;
    }

    if (sub.startsWith("use ")) {
      const parsed = parseMcpUseInput(trimmed);
      if (!parsed) {
        printLine(red("Usage: /mcp use <url> [--name <id>] [--header Authorization=Bearer …]\n"), emit);
        return true;
      }
      const headers = { ...mcpAuthHeadersFromEnv(), ...parsed.headers };
      const serverConfig: McpServerConfig = {
        enabled: true,
        url: parsed.url,
        transport: "streamable-http",
        ...(Object.keys(headers).length ? { headers } : {}),
      };
      try {
        const probeResp = (await mcpProbeServer(parsed.name, serverConfig)) as {
          ok?: boolean;
          tools?: Array<{ name: string; description?: string }>;
          error?: string;
        };
        if (probeResp?.ok === false) throw new Error(String(probeResp.error || "probe failed"));
        await upsertMcpServer(parsed.name, serverConfig);
        const count = probeResp.tools?.length ?? 0;
        printLine(green(`Saved '${parsed.name}' → ${parsed.url} (${count} tool(s)).\n`), emit);
        try {
          const resp = (await mcpReload()) as {
            ok?: boolean;
            status?: { toolCount?: number; failed?: number };
            error?: string;
          };
          if (resp?.ok === false) throw new Error(String(resp.error || "reload failed"));
          await reloadMcpTools();
          const toolCount = resp.status?.toolCount ?? count;
          printLine(dim(`MCP tools registered: ${toolCount}.\n`), emit);
        } catch (reloadErr) {
          printLine(
            amber(
              `Saved but reload failed: ${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}. Run /reload-mcp.\n`
            ),
            emit
          );
        }
      } catch (err) {
        serverConfig.enabled = false;
        await upsertMcpServer(parsed.name, serverConfig);
        printLine(
          red(
            `Probe failed — saved '${parsed.name}' as disabled: ${err instanceof Error ? err.message : String(err)}\n`
          ),
          emit
        );
      }
      return true;
    }

    if (sub.startsWith("add ")) {
      const parsed = parseMcpAddArgs(`/mcp ${sub}`);
      if (!parsed) {
        printLine(red("Could not parse /mcp add command.\n"), emit);
        return true;
      }
      if (!parsed.url && !parsed.command) {
        printLine(red("Must specify --url or --command.\n"), emit);
        return true;
      }
      const serverConfig: McpServerConfig = { enabled: true };
      if (parsed.url) {
        serverConfig.url = parsed.url;
        if (parsed.transport) serverConfig.transport = parsed.transport;
        if (Object.keys(parsed.headers).length) serverConfig.headers = parsed.headers;
      } else {
        serverConfig.command = parsed.command;
        if (parsed.args.length) serverConfig.args = parsed.args;
        if (Object.keys(parsed.env).length) serverConfig.env = parsed.env;
      }
      if (parsed.include.length) {
        serverConfig.tools = { include: parsed.include };
      }
      try {
        const probeResp = (await mcpProbeServer(parsed.name, serverConfig)) as {
          ok?: boolean;
          tools?: Array<{ name: string; description?: string }>;
          error?: string;
        };
        if (probeResp?.ok === false) throw new Error(String(probeResp.error || "probe failed"));
        await upsertMcpServer(parsed.name, serverConfig);
        const count = probeResp.tools?.length ?? 0;
        printLine(green(`Saved '${parsed.name}' (${count} tool(s) discovered).\n`), emit);
        printLine(dim("Run /reload-mcp to register tools for the agent.\n"), emit);
      } catch (err) {
        serverConfig.enabled = false;
        await upsertMcpServer(parsed.name, serverConfig);
        printLine(red(`Probe failed — saved '${parsed.name}' as disabled: ${err instanceof Error ? err.message : String(err)}\n`), emit);
      }
      return true;
    }

    printLine(red(`Unknown /mcp subcommand. Use /mcp help.\n`), emit);
    return true;
  }

  return false;
}

export async function discoverMcpOnStartup(): Promise<void> {
  const config = await loadMcpServersConfig();
  if (!Object.keys(config).length) return;
  try {
    const { tools, status } = await discoverAndRegisterMcpTools();
    const failed = status?.failed ?? 0;
    console.log(dim(formatMcpStartupBanner(tools, failed)));
  } catch (err) {
    console.log(dim(`MCP: startup discover failed (${err instanceof Error ? err.message : String(err)})`));
  }
}

export async function shutdownMcpOnExit(): Promise<void> {
  try {
    await mcpShutdown();
  } catch {
    /* ignore */
  }
}
