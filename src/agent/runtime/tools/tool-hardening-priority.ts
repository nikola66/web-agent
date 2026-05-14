/**
 * Ranked focus for tool format hardening (schema, examples, runtime coercion).
 * No production telemetry yet — reorder using transcript/guardrail data when available.
 */
export type HardeningTactic = "schema" | "examples" | "coercion";

export type ToolHardeningRow = {
  tool: string;
  rank: number;
  rationale: string;
  tactics: HardeningTactic[];
};

/** Higher impact first: approval-sensitive, multi-shape, or external I/O. */
export const TOOL_HARDENING_PRIORITY: readonly ToolHardeningRow[] = [
  {
    tool: "email",
    rank: 1,
    rationale: "Resend payload, optional action, nested-arguments confusion, user approval",
    tactics: ["schema", "examples", "coercion"],
  },
  {
    tool: "cron_register",
    rank: 2,
    rationale: "Job vs step shapes, delivery vs tool, already example-heavy",
    tactics: ["examples", "coercion"],
  },
  {
    tool: "skill_bulk_save",
    rank: 3,
    rationale: "items/url shapes, confirmation surface, easy to mix fields",
    tactics: ["schema", "examples", "coercion"],
  },
  {
    tool: "run_shell",
    rank: 4,
    rationale: "Nodebox vs host, nested arguments, blocked patterns",
    tactics: ["schema", "examples", "coercion"],
  },
  {
    tool: "memory_save",
    rank: 5,
    rationale: "Strict key+value; common omission in transcripts",
    tactics: ["schema", "examples", "coercion"],
  },
  {
    tool: "apply_patch",
    rank: 6,
    rationale: "Patch grammar; high cost on malformed hunks",
    tactics: ["examples"],
  },
  {
    tool: "write_file",
    rank: 7,
    rationale: "path/content aliases already; root guard surprises",
    tactics: ["schema", "coercion"],
  },
] as const;
