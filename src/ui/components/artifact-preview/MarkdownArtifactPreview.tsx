import mermaid from "mermaid";
import { useLayoutEffect, useMemo, useRef } from "react";
import "katex/dist/katex.min.css";
import { escapeArtifactHtml, renderArtifactMarkdown } from "./markdown-render";

let mermaidReady = false;

function ensureMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  mermaidReady = true;
}

const ARTICLE_CLASS = [
  "artifact-md",
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
  "[&_pre]:my-0 [&_pre]:overflow-x-auto [&_pre]:p-0",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[14px]",
  "[&_th]:border [&_th]:border-white/10 [&_th]:bg-white/[0.06] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-white/10 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top",
  "[&_tr:nth-child(even)_td]:bg-white/[0.02]",
  "[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-white/10",
  "[&_mark]:rounded-sm [&_mark]:bg-brand-magenta/25 [&_mark]:px-1",
  "[&_s]:text-text-muted [&_s]:line-through",
  "[&_.task-list-item]:list-none [&_.task-list-item]:pl-1",
  "[&_.task-list-item-checkbox]:mr-2 [&_.task-list-item-checkbox]:accent-brand-magenta",
  "[&_.mermaid-block]:my-4 [&_.mermaid-block]:flex [&_.mermaid-block]:min-h-[4rem] [&_.mermaid-block]:justify-center",
  "[&_.mermaid-block_svg]:max-w-full [&_.mermaid-block_svg]:h-auto",
  "[&_.mermaid-block.mermaid-error]:rounded-md [&_.mermaid-block.mermaid-error]:border [&_.mermaid-block.mermaid-error]:border-red-400/40 [&_.mermaid-block.mermaid-error]:bg-red-500/10 [&_.mermaid-block.mermaid-error]:p-3",
  "[&_.mermaid-source]:whitespace-pre-wrap [&_.mermaid-source]:text-[12px] [&_.mermaid-source]:text-red-200",
].join(" ");

async function hydrateMermaid(host: HTMLElement, signal?: AbortSignal) {
  const blocks = Array.from(
    host.querySelectorAll<HTMLElement>(".mermaid-block:not(.mermaid-rendered):not(.mermaid-error)")
  );
  if (blocks.length === 0) return;
  ensureMermaid();
  for (let i = 0; i < blocks.length; i++) {
    if (signal?.aborted) return;
    const block = blocks[i];
    const code = decodeURIComponent(block.dataset.code || "");
    if (!code.trim()) continue;
    try {
      const id = `mermaid-${Date.now()}-${i}`;
      const { svg } = await mermaid.render(id, code);
      if (signal?.aborted) return;
      block.innerHTML = svg;
      block.classList.add("mermaid-rendered");
    } catch (err) {
      if (signal?.aborted) return;
      block.classList.add("mermaid-error");
      const message = err instanceof Error ? err.message : String(err);
      block.innerHTML = `<pre class="mermaid-source">${escapeArtifactHtml(`${message}\n\n${code}`)}</pre>`;
    }
  }
}

export function MarkdownArtifactPreview({ text, mermaidOnly = false }: { text: string; mermaidOnly?: boolean }) {
  const previewRef = useRef<HTMLElement | null>(null);
  const rendered = useMemo(() => renderArtifactMarkdown(text, mermaidOnly), [text, mermaidOnly]);

  useLayoutEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    const ac = new AbortController();
    void hydrateMermaid(host, ac.signal).catch((err) => {
      if (ac.signal.aborted) return;
      console.error("Mermaid preview failed:", err);
    });
    return () => ac.abort();
  }, [rendered]);

  return (
    <article
      className={ARTICLE_CLASS}
      ref={previewRef as React.RefObject<HTMLElement>}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
