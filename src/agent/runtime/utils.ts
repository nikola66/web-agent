export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function stripAnsi(text: unknown) {
  return String(text || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b\]8;;[^\x07]*\x07/g, "");
}

export const INLINE_URL_RE = /https?:\/\/[^\s<>"'\[\]()]+/g;

export function trimTrailingUrlPunctuation(url: string): string {
  let out = url;
  while (/[.,;:!?)]+$/.test(out)) {
    const trailing = out.match(/[.,;:!?)]+$/)?.[0] ?? "";
    const openParens = (out.match(/\(/g) || []).length;
    const closeParens = (out.match(/\)/g) || []).length;
    if (trailing.includes(")") && closeParens <= openParens) break;
    out = out.slice(0, -1);
  }
  return out;
}
