import { X } from "lucide-react";
import { submitUserInput } from "@/core/orchestrator";
import { useProfileStore } from "../stores/profile-store";
import { useRuntimeStore } from "../stores/runtime-store";

export function ClarifyOfferBar() {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const clarifyOffer = useRuntimeStore((s) =>
    activeProfileId ? (s.profileRuntime[activeProfileId]?.clarifyOffer ?? null) : null,
  );
  const setClarifyOffer = useRuntimeStore((s) => s.setClarifyOffer);

  if (!activeProfileId || !clarifyOffer) return null;

  const dismiss = () => setClarifyOffer(activeProfileId, null);

  const pick = async (choice: string) => {
    await submitUserInput(choice);
    dismiss();
  };

  return (
    <div
      className="pointer-events-auto fixed right-4 z-55 flex max-w-[min(420px,calc(100vw-32px))] flex-col gap-2 p-3"
      style={{
        bottom: "7.75rem",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
      }}
      role="dialog"
      aria-label="Clarification"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-text-primary">{clarifyOffer.question}</p>
        <button
          type="button"
          aria-label="Dismiss clarification"
          className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
          onClick={() => dismiss()}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      {!clarifyOffer.openEnded && clarifyOffer.options.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {clarifyOffer.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="rounded-sm px-2 py-2 text-left text-[11px] font-medium transition-colors hover:bg-[rgba(255,255,255,0.06)]"
              style={{
                border: "1px solid var(--color-border-muted)",
                borderRadius: "var(--radius-sm)",
              }}
              onClick={() => void pick(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[10px] leading-relaxed text-text-muted">Reply in the chat input below.</p>
      )}
    </div>
  );
}
