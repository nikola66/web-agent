export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function levenshtein(a: string, b: string): number {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  const m = aa.length;
  const n = bb.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function stripAnsi(text: unknown) {
  return String(text || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b\]8;;[^\x07]*\x07/g, "");
}

export const INLINE_URL_RE = /https:\/\/[^\s<>"'\[\]()]+/g;

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
