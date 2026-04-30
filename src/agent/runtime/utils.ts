export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function stripAnsi(text: unknown) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}
