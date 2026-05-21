/**
 * Agent runtime memory — barrel re-exports from sub-modules.
 */

// SQL and file I/O utilities
export {
  getDb,
  persistDb,
  appendJsonLine,
  memoryPath,
  safeId,
  ensureMemoryDirs,
  safeWriteJson,
  safeWriteBytes,
  readJsonFile,
  readJsonFilesNewestFirst,
} from "./sql.js";

// Run history
export {
  saveRun,
} from "./runs.js";

// Background job management
export {
  upsertJob,
  getJob,
  appendJobLog,
  enqueueJobEvent,
  drainPendingJobEvents,
  acknowledgeJobEvents,
  buildJobEventsPrompt,
} from "./jobs.js";

// Snapshot spill management
export {
  sanitizeMessagesMissingSnapshotRefs,
  collectReferencedSnapshotBasenames,
  cleanupSnapshotsNotReferenced,
  unwrapSnapshotReadFileExecutions,
  spillInlineCharBudgetForToolResultItem,
  saveCompressedToolResults,
  createTurnInlineBudgetState,
  getMaxTurnInlineChars,
  TOOL_RESULTS_COMPACT_PREFIX,
  SNAPSHOT_READ_UNWRAP_MAX_CHARS,
  SNAPSHOT_FROM_SNAPSHOT_INLINE_SLACK,
} from "./snapshots.js";

// Reflections
export {
  saveReflection,
  getReflections,
  MEMORY_REFLECTION_LIMIT,
} from "./reflection.js";

// Facts
export {
  setFact,
  getFact,
  getAllFacts,
  searchFacts,
} from "./facts.js";

// Tool statistics
export {
  recordToolSuccess,
  recordToolFailure,
  getToolStats,
} from "./tool-stats.js";

// Learnings
export {
  promoteLearning,
  getPromotableLearnings,
} from "./learnings.js";

// Skills
export {
  saveSkill,
  listSkills,
  loadSkill,
  viewSkill,
  deleteSkill,
  bulkSaveSkills,
  manageSkill,
  buildSkillsContextBlock,
  invalidateSkillsContextCache,
} from "./skills.js";

export {
  getSkillWriteOrigin,
  runWithSkillWriteOrigin,
  markAgentCreated,
  recordSkillView,
  recordSkillPatch,
  recordSkillUse,
  getSkillUsage,
  listSkillUsage,
  isAgentCreatedSkill,
  isPinnedSkill,
  setSkillPinned,
  applyAutomaticSkillTransitions,
  archiveSkillDirectory,
} from "../skill-provenance.js";

export {
  evaluateBackgroundReviewTrigger,
  scheduleBackgroundReview,
  summarizeBackgroundReviewActions,
  noteUserTurnStarted,
  noteToolIteration,
  noteForegroundSkillWrite,
  noteForegroundMemoryWrite,
  resetSelfImproveCounters,
} from "../background-review.js";

export {
  maybeRunCurator,
  loadCuratorState,
  setCuratorPaused,
} from "../curator.js";

// Context blocks
export {
  buildMemoryContextBlock,
} from "./context-blocks.js";

// Constants
export {
  MEMORY_CONTEXT_CHAR_BUDGET,
} from "./context-blocks.js";
