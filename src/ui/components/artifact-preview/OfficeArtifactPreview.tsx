import { useEffect, useRef } from "react";

export function PdfArtifactPreview({ buffer }: { buffer: ArrayBuffer }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
        if (cancelled) return;
        host.replaceChildren();

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement("canvas");
          canvas.className = "mx-auto mb-4 max-w-full rounded-md border border-white/10 bg-white";
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          host.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        host.innerHTML = `<p class="text-sm text-text-muted">${message}</p>`;
      }
    })();

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [buffer]);

  return <div ref={hostRef} className="fancy-scroll mx-auto w-full max-w-4xl" />;
}

export function DocxArtifactPreview({ buffer }: { buffer: ArrayBuffer }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        host.replaceChildren();
        await renderAsync(buffer, host, host, { className: "docx-artifact", inWrapper: true });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        host.innerHTML = `<p class="text-sm text-text-muted">${message}</p>`;
      }
    })();

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [buffer]);

  return (
    <div
      ref={hostRef}
      className="docx-artifact-host fancy-scroll mx-auto w-full max-w-4xl bg-white text-black [&_.docx-artifact]:mx-auto"
    />
  );
}

export function PptxArtifactPreview({ buffer }: { buffer: ArrayBuffer }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    /** @type {{ preview?: (data: ArrayBuffer) => void } | null} */
    let viewer = null;

    (async () => {
      try {
        const { init } = await import("pptx-preview");
        if (cancelled) return;
        host.replaceChildren();
        const width = Math.min(host.clientWidth || 960, 960);
        viewer = init(host, { width, height: Math.round(width * 9 / 16) });
        viewer?.preview?.(buffer);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        host.innerHTML = `<p class="text-sm text-text-muted">${message}</p>`;
      }
    })();

    return () => {
      cancelled = true;
      viewer = null;
      host.replaceChildren();
    };
  }, [buffer]);

  return <div ref={hostRef} className="fancy-scroll mx-auto flex w-full max-w-5xl justify-center" />;
}
