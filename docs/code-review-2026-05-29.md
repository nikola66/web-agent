# Web-Agent Code Review — 2026-05-29

Reviewer: automated comprehensive pass (Opus 4.8). Scope: full `src/` tree (~49k LOC, 130+ modules), test suite, and type-check.

## Verification baseline

| Check | Result |
|-------|--------|
| `npm test` (node suite) | **871 pass, 0 fail, 1 skip** |
| Skipped test | `composio-catalog-live` — requires `API_KEY`, expected |
| `tsc -b` | clean, 0 type errors |
| Playwright `*.spec.ts` | not run — need live API keys + browser (slow/flaky) |

## Defect found and fixed

**`estimateMessageTokens` undercounted non-string message content.**
`src/agent/runtime/llm/streaming.ts`

- Before: `estimateTokens(msg.content || "")`. When `content` is an **array** of multimodal parts (text + image), `String(content)` → `"[object Object]"` → ~4 tokens. `tool_calls` payloads were ignored entirely (content is `null` on those messages).
- Impact: this estimate drives `context-compression.ts` threshold decisions (`maybeCompactHistory`, `compactMessages`, `tailStartIndex`). Undercounting suppresses compaction **exactly when messages are largest** (images, big tool results) → risk of context overflow, dropped history, slower/more-expensive turns.
- Fix: stringify non-string content (counts text + base64 image length) and add `tool_calls` token cost. Mirrors existing `estimateToolSchemaTokens`.
- Regression test added: `tests/streaming-sanitize.test.ts` → "estimateMessageTokens counts array content and tool_calls".
- This is both a correctness fix and a **speed/cost win**: accurate compaction → smaller payloads to the LLM, fewer overflow failures.

## Subsystem review — findings

### Tool execution (`tools/registry.ts`, `runTools`)
Strong. Read-only safe tools batch concurrently with `MAX_PARALLEL_TOOLS` cap (6); write/unsafe tools stay serial. Dedup of duplicate emissions (native `tool_calls` + `<<<TOOL>>>` markers) via serialized key set. No changes recommended.

### Streaming parser (`llm/streaming.ts`, `createToolAwareStreamWriter`)
Correct incremental design: buffer is sliced down each `push`, partial hidden-marker prefixes retained across chunks (`longestToolPrefixSuffix`), no unbounded `indexOf` over a growing buffer (no O(n²)). Per-message regexes (`stripPseudoToolCallLines`) compile once per assistant message, not per chunk. Intent regexes are module-level constants.

### Context compaction (`context-compression.ts`)
`estimateMessagesTokens` called a constant number of times per compaction (before/after), not in a tight loop. Now fed accurate estimates by the fix above.

### UI / React (`ui/components/*`, zustand stores)
Well-architected. All store reads are **atomic selectors** (`s => s.field`) — no new-object-per-render subscriptions, so no spurious re-renders. `Terminal` consumes the high-frequency output stream via imperative `useRuntimeStore.subscribe`, deliberately bypassing React render churn. `ChatInput`/`StatusBar` use `useMemo`/`useCallback` on derived data.

### Async safety (whole tree)
No floating/unawaited promises found. `JSON.parse` callsites are consistently wrapped in `try` (or feed `safeParse`-style helpers). No `parseInt` missing radix. No global-regex `lastIndex` reuse bugs.

## Optional improvements (NOT applied — would churn clean, working, tested code)

Listed for the maintainer to decide; each carries regression risk against existing tests/behavior:

1. **Parallelize `listLiveWorkspaceFiles` walk** (`core/workspace.ts:462`) — serial `stat` per entry. `Promise.all` per directory would speed the file-panel refresh, but reorders `results` and stresses nodebox FS concurrency; would risk `workspace-layout-parity` tests. Only worth it if the file panel is measurably slow on large workspaces.
2. **`estimateTokens` heuristic** — `length / 4` is a rough proxy; fine for thresholds, not for hard budget caps. Leave unless billing-accurate counts are needed.

## Conclusion

Mature, high-quality, well-tested codebase. One real defect found and fixed (with a regression test); type-check and full node suite green. No systemic bug or perf classes detected. Remaining suggestions are optional and risk-noted rather than blindly applied — preserving working behavior over speculative churn.
