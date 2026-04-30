import { normalizeCronStepArguments, sanitizeCronToolToken } from "../state/persistence.js";

/** Job-level only — never use as a step \`tool\`. */
const JOB_DELIVERY_MODES = new Set(["silent", "terminal", "email"]);

export type CanonicalCronStep = { tool: string; arguments: Record<string, unknown> };

function stepError(stepNumber: number, message: string): Error {
  return new Error(`cron_register: step ${stepNumber}: ${message}`);
}

function shellSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}

/** If \`tool\`/\`action\` is missing, infer tool from \`arguments\` shape (LLM shortcut). */
function inferToolFromArgumentsOnly(
  args: Record<string, unknown>,
  stepNumber: number
): CanonicalCronStep {
  if (typeof args.command === "string" && args.command.trim()) {
    return { tool: "run_shell", arguments: args };
  }
  if (typeof args.url === "string" && args.url.trim()) {
    return { tool: "web_fetch", arguments: args };
  }
  if (typeof args.to === "string" && args.to.trim() && typeof args.subject === "string") {
    return { tool: "email", arguments: args };
  }
  if (typeof args.pattern === "string" && args.pattern.trim()) {
    return { tool: "grep", arguments: args };
  }
  if (typeof args.query === "string" && args.query.trim()) {
    if ("max_files" in args) {
      return { tool: "session_search", arguments: args };
    }
    if (
      "limit" in args &&
      !("page" in args) &&
      !("location" in args) &&
      !("language" in args)
    ) {
      return { tool: "memory_search", arguments: args };
    }
    return { tool: "web_search", arguments: args };
  }
  throw stepError(
    stepNumber,
    'missing "tool" and no inferable arguments. Use {"tool":"<builtin>","arguments":{...}} — see tool description JSON examples.'
  );
}

function coerceDeliveryMisnamedStep(
  o: Record<string, unknown>,
  mistaken: string,
  stepNumber: number
): CanonicalCronStep {
  const cmd = String(o.command ?? "").trim();
  const text = String(o.text ?? o.message ?? "").trim();
  if (cmd) {
    const base = normalizeCronStepArguments(o);
    return { tool: "run_shell", arguments: { ...base, command: cmd } };
  }
  if (text) {
    const command = `printf '%s\\n' ${shellSingleQuote(text)}`;
    return { tool: "run_shell", arguments: { command } };
  }
  throw stepError(
    stepNumber,
    `"${mistaken}" is a job delivery mode, not a tool. Set top-level "delivery" to "${mistaken}" and set this step's "tool" to a builtin (e.g. web_search or run_shell).`
  );
}

/**
 * Turn mixed model shapes into canonical \`{ tool, arguments }\` for persistence.
 * Prefer callers to send canonical steps; coercion exists for common mistakes only.
 */
export function normalizeCronRegisterSteps(raw: unknown[]): CanonicalCronStep[] {
  return raw.map((step, index) => coerceOneStep(step, index + 1));
}

function coerceOneStep(step: unknown, stepNumber: number): CanonicalCronStep {
  if (typeof step === "string") {
    const cmd = step.trim();
    if (!cmd) {
      throw stepError(
        stepNumber,
        'empty shell string. Use {"tool":"run_shell","arguments":{"command":"..."}} or a non-empty string.'
      );
    }
    return { tool: "run_shell", arguments: { command: step } };
  }

  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw stepError(
      stepNumber,
      'expected an object {"tool":"...","arguments":{}} or a shell string for run_shell.'
    );
  }

  const o = step as Record<string, unknown>;
  const name = sanitizeCronToolToken(o.tool ?? o.action ?? "");

  if (name && JOB_DELIVERY_MODES.has(name)) {
    return coerceDeliveryMisnamedStep(o, name, stepNumber);
  }

  if (name) {
    return { tool: name, arguments: normalizeCronStepArguments(o) };
  }

  return inferToolFromArgumentsOnly(normalizeCronStepArguments(o), stepNumber);
}

export function assertCronStepsUseAllowedTools(
  steps: CanonicalCronStep[],
  allowed: Set<string>
): void {
  const list = [...allowed].sort().join(", ");
  for (let i = 0; i < steps.length; i++) {
    const t = steps[i].tool;
    if (!t) {
      throw new Error(`cron_register: step ${i + 1}: empty tool name after normalize.`);
    }
    if (!allowed.has(t)) {
      throw new Error(`cron_register: step ${i + 1}: unknown tool "${t}". Valid names: ${list}`);
    }
  }
}
