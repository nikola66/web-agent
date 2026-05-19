/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_WEBAGENT_LOOP_GUARD?: string;
  readonly VITE_WEBAGENT_MAX_AUTO_CONTINUE_NUDGES?: string;
  readonly VITE_WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES?: string;
  readonly VITE_WEBAGENT_LOOP_GUARD_MAX_MESSAGES?: string;
  readonly VITE_WEBAGENT_LOOP_GUARD_STOP_THRESHOLD?: string;
  readonly VITE_WEBAGENT_LOOP_GUARD_ASK_USER_THRESHOLD?: string;
  readonly VITE_WEBAGENT_LOOP_GUARD_CONTINUE_THRESHOLD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const src: string;
  export default src;
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
