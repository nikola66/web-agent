# Revert user message highlighting and extra breaklines

**File:** `src/agent/runtime/terminal-format.ts`

## Edit 1: Remove color constants (lines 6-9)

Remove:
```
/** Slightly lifted row background for user messages in xterm (matches elevated surface elsewhere). */
export const USER_LINE_BG = "\x1b[48;2;17;17;17m";
export const USER_TEXT_GREY = "\x1b[38;2;156;163;175m";
export const USER_LABEL_GREY_BOLD = "\x1b[1;38;2;156;163;175m";
```

## Edit 2: Remove `userRowBgPad()` function (lines 477-483)

Remove:
```
/** Pad with spaces so the 48-bit background paints to the right edge for one logical row (no wrap). */
function userRowBgPad(ansiVisibleLine: string) {
  const cols = terminalColumnCount();
  const w = stripAnsi(ansiVisibleLine).length;
  const pad = w >= cols ? 0 : cols - w;
  return pad > 0 ? " ".repeat(pad) : "";
}
```

## Edit 3: Simplify `renderUserBlock()` (lines 485-505)

Replace the entire function:
```ts
export function renderUserBlock(
  input: unknown,
  userName: unknown,
  cleanSetupName: (raw: unknown, fallback: string) => string
) {
  const name = cleanSetupName(userName, "You");
  process.stdout.write(`${name}\n`);
  const lines = String(input || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const prefix = i === 0 ? " ⎿ " : BLOCK_CONTINUATION_PREFIX;
    process.stdout.write(`${prefix}${lines[i]}\n`);
  }
}
```

Changes in this function:
- Removed `process.stdout.write("\n");` (was extra blank line before)
- Removed `USER_LABEL_GREY_BOLD` wrapping on name label
- Removed `USER_LINE_BG` + `userRowBgPad()` from label line
- Removed `USER_TEXT_GREY` wrapping on body lines
- Removed `USER_LINE_BG` + `userRowBgPad()` from body lines
- Changed `process.stdout.write("\n\n");` to no trailing extra blank lines (output ends with last `\n` from the loop)
