import { logDebugEvent } from "./logging/debug-log.js";
import { errorMessage } from "./utils.js";

export async function emitTranscriptEvent(
  target: unknown,
  event: unknown,
  details: Record<string, unknown> = {}
) {
  const onTranscript = typeof target === "function" ? target : target?.onTranscript;
  if (typeof onTranscript !== "function") return { delivered: false, skipped: true };
  try {
    await Promise.resolve(onTranscript(event));
    return { delivered: true };
  } catch (error) {
    const critical = Boolean(event?.critical);
    await logDebugEvent(
      critical ? "assistant_transcript_delivery_failed" : "transcript_delivery_failed",
      {
        eventType: String(event?.type || "unknown"),
        critical,
        error: errorMessage(error),
        ...details,
      }
    ).catch(() => {});
    if (critical) throw error;
    return { delivered: false, error };
  }
}
