import MarkdownIt from "markdown-it";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, X } from "lucide-react";
import { useProfileStore } from "../stores/profile-store";
import { useRuntimeStore } from "../stores/runtime-store";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/**
 * Custom fence renderer: when the info-string is `mermaid`, emit a
 * placeholder div that we render into via the `mermaid` library on mount.
 * Other languages keep the default `<pre><code>` rendering.
 */
const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token.info || "").trim().toLowerCase();
  if (info === "mermaid") {
    const encoded = encodeURIComponent(token.content);
    return `<div class="mermaid-block" data-code="${encoded}"><pre class="mermaid-source">${md.utils.escapeHtml(token.content)}</pre></div>`;
  }
  return defaultFence
    ? defaultFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

export function ArtifactOfferBar() {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const artifactOffer = useRuntimeStore((s) =>
    activeProfileId ? s.profileRuntime[activeProfileId]?.artifactOffer ?? null : null,
  );
  const setArtifactOffer = useRuntimeStore((s) => s.setArtifactOffer);
  const [modalOpen, setModalOpen] = useState(false);

  const rendered = useMemo(() => {
    if (!artifactOffer) return "";
    return md.render(artifactOffer.markdown);
  }, [artifactOffer]);
  const previewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!modalOpen) return;
    const host = previewRef.current;
    if (!host) return;
    const blocks = Array.from(host.querySelectorAll<HTMLElement>(".mermaid-block"));
    if (blocks.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        for (let i = 0; i < blocks.length; i++) {
          if (cancelled) return;
          const block = blocks[i];
          const code = decodeURIComponent(block.dataset.code || "");
          if (!code.trim()) continue;
          try {
            const id = `mermaid-${Date.now()}-${i}`;
            const { svg } = await mermaid.render(id, code);
            if (cancelled) return;
            block.innerHTML = svg;
            block.classList.add("mermaid-rendered");
          } catch (err) {
            block.classList.add("mermaid-error");
            const message = err instanceof Error ? err.message : String(err);
            block.innerHTML = `<pre class="mermaid-source">${message}\n\n${code}</pre>`;
          }
        }
      } catch {
        /* mermaid load failed — leave source pre blocks intact */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [modalOpen, rendered]);

  if (!activeProfileId || !artifactOffer) {
    return null;
  }

  const dismiss = () => {
    setModalOpen(false);
    setArtifactOffer(activeProfileId, null);
  };

  const onDownload = () => {
    const blob = new Blob([artifactOffer.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = artifactOffer.filename || "artifact.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div
        className="pointer-events-auto fixed right-4 bottom-20 z-60 flex max-w-[min(480px,calc(100vw-32px))] flex-col gap-1.5 p-3"
        style={{
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
        }}
        role="status"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-tight text-text-primary truncate">
              {artifactOffer.title}
            </p>
            <p className="truncate text-[10px] text-text-muted">{artifactOffer.filename}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss artifact"
            className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
            onClick={() => dismiss()}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-[11px] font-medium transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
            }}
            onClick={() => setModalOpen(true)}
          >
            <Eye size={14} strokeWidth={1.5} aria-hidden /> View
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-[11px] font-medium transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{
              border: "1px solid var(--color-border-muted)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-brand-magenta-light)",
            }}
            onClick={onDownload}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden /> Download
          </button>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-70 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.65)" }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="fancy-scroll flex h-[min(88vh,900px)] w-full max-w-4xl flex-col overflow-hidden"
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-elevated)",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Markdown artifact"
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">{artifactOffer.title}</p>
                <p className="truncate pt-0.5 text-[11px] text-text-muted">{artifactOffer.filename}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-sm px-2 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                  onClick={onDownload}
                >
                  Download
                </button>
                <button
                  type="button"
                  aria-label="Close preview"
                  className="rounded p-1 text-text-muted hover:text-text-primary"
                  onClick={() => setModalOpen(false)}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="fancy-scroll flex-1 overflow-auto px-4 py-4">
              <article
                className={[
                  "mx-auto w-full max-w-[76ch] text-[15px] leading-7 text-text-primary",
                  "[&_a]:text-brand-magenta-light [&_a]:underline-offset-2 hover:[&_a]:underline",
                  "[&_p]:my-0 [&_p+*]:mt-4",
                  "[&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight",
                  "[&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight",
                  "[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:leading-tight",
                  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
                  "[&_li]:my-1.5",
                  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-text-muted",
                  "[&_hr]:my-6 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-white/10",
                  "[&_code]:rounded-sm [&_code]:bg-black/35 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.92em]",
                  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-white/10 [&_pre]:bg-black/40 [&_pre]:p-3",
                  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                  "[&_.mermaid-block]:my-4 [&_.mermaid-block]:flex [&_.mermaid-block]:justify-center",
                  "[&_.mermaid-block_svg]:max-w-full [&_.mermaid-block_svg]:h-auto",
                  "[&_.mermaid-source]:whitespace-pre-wrap [&_.mermaid-source]:rounded-md [&_.mermaid-source]:border [&_.mermaid-source]:border-white/10 [&_.mermaid-source]:bg-black/40 [&_.mermaid-source]:p-3 [&_.mermaid-source]:text-[12px]",
                ].join(" ")}
                ref={previewRef as React.RefObject<HTMLElement>}
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
