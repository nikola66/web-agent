/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
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
