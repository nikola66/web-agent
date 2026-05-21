/**
 * Hermes-inspired malformed tool argument repair cases.
 */

export type ArgumentRepairCategory =
  | "quoted_keys"
  | "wire_json"
  | "path_coercion"
  | "schema_coercion"
  | "registry_prep";

export type ArgumentRepairCase = {
  id: string;
  tool: string;
  category: ArgumentRepairCategory;
  raw: unknown;
  /** Expected fields after full repair (subset match). */
  expect: Record<string, unknown>;
  /** Must pass validateRequiredArguments when set. */
  requireValid?: boolean;
};

export const TOOL_ARGUMENT_REPAIR_CASES: ArgumentRepairCase[] = [
  {
    id: "session_search_quoted_key",
    tool: "session_search",
    category: "quoted_keys",
    raw: { '"query"': '"Ainex sales outreach plan assets"' },
    expect: { query: "Ainex sales outreach plan assets" },
    requireValid: true,
  },
  {
    id: "session_search_wire_json",
    tool: "session_search",
    category: "wire_json",
    raw: '{"query": "Ainex sales outreach plan assets"}',
    expect: { query: "Ainex sales outreach plan assets" },
    requireValid: true,
  },
  {
    id: "session_search_trailing_comma",
    tool: "session_search",
    category: "wire_json",
    raw: '{"query": "recent",}',
    expect: { query: "recent" },
    requireValid: true,
  },
  {
    id: "session_search_unclosed_brace",
    tool: "session_search",
    category: "wire_json",
    raw: '{"query": "last session"',
    expect: { query: "last session" },
    requireValid: true,
  },
  {
    id: "session_search_literal_newline",
    tool: "session_search",
    category: "wire_json",
    raw: '{"query": "line one\nline two"}',
    expect: { query: "line one\nline two" },
    requireValid: true,
  },
  {
    id: "session_memory_append_quoted",
    tool: "session_memory_append",
    category: "quoted_keys",
    raw: { '"text"': '"Outreach plan path noted"' },
    expect: { text: "Outreach plan path noted" },
    requireValid: true,
  },
  {
    id: "session_memory_list_limit_string",
    tool: "session_memory_list",
    category: "schema_coercion",
    raw: { limit: "30" },
    expect: { limit: 30 },
  },
  {
    id: "list_dir_root_slash",
    tool: "list_dir",
    category: "path_coercion",
    raw: { path: "/" },
    expect: { path: "." },
  },
  {
    id: "list_dir_workspace_label",
    tool: "list_dir",
    category: "path_coercion",
    raw: { path: "/workspace" },
    expect: { path: "." },
  },
  {
    id: "grep_root_slash",
    tool: "grep",
    category: "path_coercion",
    raw: { pattern: "outreach", root: "/" },
    expect: { pattern: "outreach", root: "." },
  },
  {
    id: "find_files_patterns_wire",
    tool: "find_files",
    category: "wire_json",
    raw: '{"patterns": ["ainex", "outreach"], "root": "."}',
    expect: { patterns: ["ainex", "outreach"], root: "." },
  },
  {
    id: "find_files_comma_pattern",
    tool: "find_files",
    category: "wire_json",
    raw: '{"pattern": "ainex,outreach", "root": "."}',
    expect: { pattern: "ainex,outreach", root: "." },
  },
  {
    id: "find_files_glob_stars_any",
    tool: "find_files",
    category: "wire_json",
    raw: '{"patterns":["*outreach*","*sequence*"],"matchMode":"any"}',
    expect: { patterns: ["outreach", "sequence"], matchMode: "any" },
  },
  {
    id: "list_dir_truncated_glm",
    tool: "list_dir",
    category: "wire_json",
    raw: '{"path": "projects"}',
    expect: { path: "projects" },
  },
  {
    id: "session_search_empty_wire",
    tool: "session_search",
    category: "wire_json",
    raw: "",
    expect: {},
  },
  {
    id: "session_search_garbage_wire",
    tool: "session_search",
    category: "wire_json",
    raw: "totally not json",
    expect: {},
  },
];

export const ARGUMENT_REPAIR_TARGET_COUNT = TOOL_ARGUMENT_REPAIR_CASES.length;

export function countRepairCasesByCategory(cases: ArgumentRepairCase[]): Record<ArgumentRepairCategory, number> {
  const counts = {} as Record<ArgumentRepairCategory, number>;
  for (const c of cases) {
    counts[c.category] = (counts[c.category] || 0) + 1;
  }
  return counts;
}
