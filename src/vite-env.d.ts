/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_BUILD_ID: string;
  readonly VITE_WEBAGENT_RUNTIME?: string;
  readonly VITE_LINUXONTAB_ASSET_BASE?: string;
  readonly VITE_LINUXONTAB_ISO?: string;
  readonly VITE_LINUXONTAB_MEM_MB?: string;
  readonly VITE_LINUXONTAB_RELAY_URL?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_WARNINGS?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_HARD_STOP?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_EXACT_FAILURE_WARN_AFTER?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_EXACT_FAILURE_BLOCK_AFTER?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_WARN_AFTER?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_SAME_TOOL_FAILURE_HALT_AFTER?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_NO_PROGRESS_WARN_AFTER?: string;
  readonly VITE_WEBAGENT_TOOL_LOOP_NO_PROGRESS_BLOCK_AFTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const src: string;
  export default src;
}

declare module "*?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module "sql.js/dist/sql-wasm.js" {
  const initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<{
    Database: new (data?: Uint8Array) => {
      exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
      close(): void;
    };
  }>;
  export default initSqlJs;
}

declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  export default function taskLists(
    md: MarkdownIt,
    options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean },
  ): void;
}
