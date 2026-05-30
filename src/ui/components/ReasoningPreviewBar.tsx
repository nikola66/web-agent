import { profileAgentWorking, useActiveProfileRuntime } from "../stores/runtime-store";

export function ReasoningPreviewBar() {
  const rt = useActiveProfileRuntime();
  const reasoningPreview = rt.reasoningPreview;
  const agentWorking = profileAgentWorking(rt);

  if (!agentWorking || !reasoningPreview?.text) return null;

  return (
    <div
      className="webagent-reasoning-preview pointer-events-none mx-3 mb-1 flex min-w-0 items-start gap-2 px-1 py-1"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="reasoning-preview-bar"
    >
      <span
        className="webagent-thinking-dots mt-1 inline-flex shrink-0 items-center gap-0.5"
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
      </span>
      <p className="webagent-reasoning-preview-text min-w-0 flex-1 text-[11px] leading-snug">
        {reasoningPreview.text}
      </p>
    </div>
  );
}
