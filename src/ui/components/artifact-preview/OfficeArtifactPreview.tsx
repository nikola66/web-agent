import { useEffect, useRef, useState } from "react";

export function PdfArtifactPreview({ buffer }: { buffer: ArrayBuffer }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
      setBlobUrl(url);
      setError(null);
    } catch (err) {
      setBlobUrl(null);
      setError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [buffer]);

  if (error) {
    return <p className="text-sm text-text-muted">{error}</p>;
  }
  if (!blobUrl) {
    return <p className="text-sm text-text-muted">Loading PDF…</p>;
  }

  return (
    <iframe
      src={blobUrl}
      title="PDF preview"
      className="mx-auto block w-full max-w-4xl rounded-md border border-white/10 bg-white"
      style={{ height: "min(72vh, 900px)" }}
    />
  );
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
