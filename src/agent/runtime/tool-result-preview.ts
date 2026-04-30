/**
 * One-line summary of tool `result` for compact "Tool results (compact JSON)" messages.
 * Must surface real body fields (`content`, `text`, `markdown`, `transcript`) — generic `object{…}` hides web_fetch bodies
 * (TinyFish or proxy) and causes read_file / snapshot loops.
 */
export function summarizeToolResultPreview(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    for (const key of ["content", "text", "markdown", "transcript"]) {
      const raw = value[key];
      if (typeof raw === "string" && raw.trim()) {
        const compact = raw.replace(/\s+/g, " ").trim();
        const cap = value.from_snapshot ? 2_500 : 600;
        const excerpt = compact.length > cap ? `${compact.slice(0, cap)}…` : compact;
        return `${key} (${compact.length} chars): ${excerpt}`;
      }
    }
    const keys = Object.keys(value);
    const keyList = keys.slice(0, 6).join(", ");
    return `object{${keyList}${keys.length > 6 ? ", …" : ""}}`;
  }
  return String(value);
}
