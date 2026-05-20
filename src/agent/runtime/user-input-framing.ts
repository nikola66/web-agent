/** Framed stdin line from web UI when the message contains newlines (see bootstrap readline). */
export const USER_INPUT_START = "<<<WEBAGENT_USER_INPUT>>>";
export const USER_INPUT_END = "<<<END_WEBAGENT_USER_INPUT>>>";

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** One stdin write: single line for readline, preserving internal newlines when needed. */
export function encodeUserInputLineForAgent(input: string): string {
  if (!input.includes("\n") && !input.includes("\r")) {
    return `${input}\n`;
  }
  const payload = utf8ToBase64(input);
  return `${USER_INPUT_START}${payload}${USER_INPUT_END}\n`;
}

export type FramedUserInputTake =
  | { kind: "incomplete" }
  | { kind: "complete"; line: string; rest: string };

/** Returns null when the buffer does not begin with a framed user-input block. */
export function takeFramedUserInput(buffer: string): FramedUserInputTake | null {
  if (!buffer.startsWith(USER_INPUT_START)) return null;
  const endAt = buffer.indexOf(USER_INPUT_END);
  if (endAt === -1) return { kind: "incomplete" };
  const payload = buffer.slice(USER_INPUT_START.length, endAt);
  let rest = buffer.slice(endAt + USER_INPUT_END.length);
  if (rest.startsWith("\r")) rest = rest.slice(1);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return { kind: "complete", line: base64ToUtf8(payload), rest };
}
