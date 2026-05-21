const AT_TOKEN_RE = /(?:^|[\s(,])@([^\s@]*)$/;

export type AtReferenceQuery = {
  query: string;
  replaceStart: number;
  replaceEnd: number;
};

export function getAtReferenceQuery(value: string, cursor: number): AtReferenceQuery | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);
  const match = before.match(AT_TOKEN_RE);
  if (!match) return null;

  const query = match[1] ?? "";
  const atIndex = before.length - query.length - 1;
  return {
    query,
    replaceStart: atIndex,
    replaceEnd: safeCursor,
  };
}

export function insertAtReference(
  value: string,
  replaceStart: number,
  replaceEnd: number,
  path: string
): { nextValue: string; nextCursor: number } {
  const token = `@${path} `;
  const nextValue = `${value.slice(0, replaceStart)}${token}${value.slice(replaceEnd)}`;
  const nextCursor = replaceStart + token.length;
  return { nextValue, nextCursor };
}

export function extractAtReferences(message: string): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  const re = /(?:^|[\s(,])@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    const path = match[1]?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    refs.push(path);
  }
  return refs;
}

export function appendReferencedFilesNote(message: string, refs: string[]): string {
  if (refs.length === 0) return message;
  const note = `Referenced workspace files: ${refs.join(", ")}`;
  if (message.includes(note)) return message;
  return message ? `${message}\n\n${note}` : note;
}
