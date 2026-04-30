function normalizeFailureText(value) {
  return String(value || "").trim().toLowerCase();
}

function classifyFailure(text) {
  const normalized = normalizeFailureText(text);
  if (!normalized) return "unknown";
  if (normalized.includes("required") || normalized.includes("invalid argument")) return "validation";
  if (normalized.includes("unknown tool")) return "registry";
  if (normalized.includes("timed out")) return "timeout";
  if (normalized.includes("aborted") || normalized.includes("cancel")) return "interruption";
  if (normalized.includes("enoent") || normalized.includes("not found")) return "missing_resource";
  if (normalized.includes("network") || normalized.includes("fetch")) return "network";
  return "execution";
}

function deriveImprovementFromCategories(categories) {
  if (categories.validation > 0) {
    return "Validate required tool arguments before execution and coerce obvious scalar type drift.";
  }
  if (categories.timeout > 0) {
    return "Prefer staged execution with checkpoints for long-running commands and poll progress incrementally.";
  }
  if (categories.registry > 0) {
    return "Use only currently registered tool names and align schemas with active availability.";
  }
  if (categories.interruption > 0) {
    return "Persist durable checkpoints so interrupted jobs can resume without losing progress.";
  }
  if (categories.execution > 0) {
    return "Capture concise error summaries and retry with corrected arguments before moving on.";
  }
  return "Continue using available tools before final answers when external state is needed.";
}

export function derivePromotableLearning(run, categories = {}) {
  const validationCount = Number(categories.validation || 0);
  const timeoutCount = Number(categories.timeout || 0);
  const executionCount = Number(categories.execution || 0);
  const toolCount = Array.isArray(run?.tool_calls) ? run.tool_calls.length : 0;
  if (validationCount > 0) {
    return {
      category: "tool_validation",
      statement: "Validate required tool arguments and coerce common scalar drift before execution.",
      confidence: Math.min(0.95, 0.65 + validationCount * 0.1),
    };
  }
  if (timeoutCount > 0) {
    return {
      category: "long_running_jobs",
      statement: "For long-running shell work, use durable job state with incremental progress updates.",
      confidence: Math.min(0.9, 0.6 + timeoutCount * 0.1),
    };
  }
  if (executionCount === 0 && toolCount >= 3 && run?.status === "completed") {
    return {
      category: "tool_strategy",
      statement: "Chain tools before final response when the request depends on external or filesystem state.",
      confidence: 0.72,
    };
  }
  return null;
}

export function createReflectionFromRun(run) {
  const toolCount = Array.isArray(run?.tool_calls) ? run.tool_calls.length : 0;
  const failures = [
    ...(Array.isArray(run?.tool_results)
      ? run.tool_results.filter((item) => item?.error).map((item) => `${item.tool}: ${item.error}`)
      : []),
    ...(Array.isArray(run?.rejected_tool_calls)
      ? run.rejected_tool_calls.map((item) => `${item.name || "unknown"}: ${item.reason}`)
      : []),
    ...(Array.isArray(run?.errors) ? run.errors : []),
  ];
  const categories = failures.reduce((acc, entry) => {
    const key = classifyFailure(entry);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const failureCount = failures.length;
  const confidence = failureCount === 0 ? 0.82 : Math.max(0.35, 0.8 - Math.min(0.45, failureCount * 0.08));
  return {
    id: `reflection_${run.id}`,
    run_id: run.id,
    what_worked:
      run.status === "completed"
        ? `${toolCount} tool call(s) processed; assistant returned visible output.`
        : "Run was captured for diagnosis.",
    what_failed: failures.length ? failures.slice(0, 6).join("; ") : "No observed failures.",
    improvement: deriveImprovementFromCategories(categories),
    confidence: Number(confidence.toFixed(2)),
    failure_categories: categories,
    created_at: new Date().toISOString(),
  };
}
