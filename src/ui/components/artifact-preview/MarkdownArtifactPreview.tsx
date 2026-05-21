import MarkdownIt from "markdown-it";
import mermaid from "mermaid";
import { useLayoutEffect, useMemo, useRef } from "react";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

let mermaidReady = false;

function ensureMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  mermaidReady = true;
}

function isMermaidFence(info: string): boolean {
  const tag = info.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return tag === "mermaid";
}

const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (isMermaidFence(token.info || "")) {
    const encoded = encodeURIComponent(token.content);
    return `<div class="mermaid-block" data-code="${encoded}"></div>`;
  }
  return defaultFence
    ? defaultFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

const ARTICLE_CLASS = [
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
  "[&_.mermaid-block]:my-4 [&_.mermaid-block]:flex [&_.mermaid-block]:min-h-[4rem] [&_.mermaid-block]:justify-center",
  "[&_.mermaid-block_svg]:max-w-full [&_.mermaid-block_svg]:h-auto",
  "[&_.mermaid-block.mermaid-error]:rounded-md [&_.mermaid-block.mermaid-error]:border [&_.mermaid-block.mermaid-error]:border-red-400/40 [&_.mermaid-block.mermaid-error]:bg-red-500/10 [&_.mermaid-block.mermaid-error]:p-3",
  "[&_.mermaid-source]:whitespace-pre-wrap [&_.mermaid-source]:text-[12px] [&_.mermaid-source]:text-red-200",
].join(" ");

async function hydrateMermaid(host: HTMLElement) {
  const blocks = Array.from(
    host.querySelectorAll<HTMLElement>(".mermaid-block:not(.mermaid-rendered):not(.mermaid-error)")
  );
  if (blocks.length === 0) return;
  ensureMermaid();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const code = decodeURIComponent(block.dataset.code || "");
    if (!code.trim()) continue;
    try {
      const id = `mermaid-${Date.now()}-${i}`;
      const { svg } = await mermaid.render(id, code);
      block.innerHTML = svg;
      block.classList.add("mermaid-rendered");
    } catch (err) {
      block.classList.add("mermaid-error");
      const message = err instanceof Error ? err.message : String(err);
      block.innerHTML = `<pre class="mermaid-source">${md.utils.escapeHtml(`${message}\n\n${code}`)}</pre>`;
    }
  }
}

export function MarkdownArtifactPreview({ text, mermaidOnly = false }: { text: string; mermaidOnly?: boolean }) {
  const previewRef = useRef<HTMLElement | null>(null);
  const rendered = useMemo(() => {
    if (mermaidOnly) {
      const encoded = encodeURIComponent(text);
      return `<div class="mermaid-block" data-code="${encoded}"></div>`;
    }
    return md.render(text);
  }, [text, mermaidOnly]);

  useLayoutEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    let cancelled = false;
    void hydrateMermaid(host).catch((err) => {
      if (cancelled) return;
      console.error("Mermaid preview failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [rendered]);

  return (
    <article
      className={ARTICLE_CLASS}
      ref={previewRef as React.RefObject<HTMLElement>}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}
