/**
 * Argument validation and normalization — barrel re-exports from validation sub-modules.
 */

export {
  coerceValueBySchema,
  schemaAllowsNull,
} from "./validation/coerce.js";

export {
  validateRequiredArguments,
  normalizeToolArguments,
} from "./validation/validate.js";

export {
  resolveInputSchema,
} from "./validation/resolve-schema.js";
