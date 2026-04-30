declare module "@embed-runtime/tools/upload-allowlist.js" {
  export const ALLOWED_UPLOAD_EXTENSIONS: ReadonlySet<string>;
  export function isAllowedUploadFile(name: string): boolean;
}
