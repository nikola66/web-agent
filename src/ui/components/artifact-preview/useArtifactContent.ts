import { useEffect, useRef, useState } from "react";
import type { ArtifactKind } from "@/core/artifact-preview";
import { inferArtifactKind, mimeForArtifactKind } from "@/core/artifact-preview";
import { readWorkspaceFileBuffer, readWorkspaceFileText } from "@/core/workspace";

export type ArtifactOfferPayload = {
  title: string;
  filename: string;
  kind: ArtifactKind;
  path?: string;
  markdown?: string;
};

export type ArtifactContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      kind: ArtifactKind;
      text?: string;
      buffer?: ArrayBuffer;
      blobUrl?: string;
      mimeType: string;
    };

const TEXT_KINDS = new Set<ArtifactKind>(["markdown", "mermaid"]);

export function useArtifactContent(
  profileId: string | null,
  offer: ArtifactOfferPayload | null,
  enabled: boolean,
  reloadKey = 0,
): ArtifactContentState {
  const [state, setState] = useState<ArtifactContentState>({ status: "idle" });
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    if (!enabled || !offer) {
      setState({ status: "idle" });
      return;
    }

    const kind = offer.kind || inferArtifactKind(offer.filename);
    const mimeType = mimeForArtifactKind(kind, offer.filename);
    let cancelled = false;

    if (offer.markdown?.trim()) {
      setState({
        status: "ready",
        kind,
        text: offer.markdown,
        mimeType,
      });
      return;
    }

    if (!offer.path || !profileId) {
      setState({ status: "error", message: "Artifact path is missing." });
      return;
    }

    setState({ status: "loading" });

    (async () => {
      try {
        if (TEXT_KINDS.has(kind)) {
          const text = await readWorkspaceFileText(profileId, offer.path!, { preferLive: true });
          if (cancelled) return;
          setState({ status: "ready", kind, text, mimeType });
          return;
        }

        const buffer = await readWorkspaceFileBuffer(profileId, offer.path!, { preferLive: true });
        if (cancelled) return;

        if (kind === "image" || kind === "audio" || kind === "video") {
          const blobUrl = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
          blobUrlRef.current = blobUrl;
          setState({ status: "ready", kind, buffer, blobUrl, mimeType });
          return;
        }

        setState({ status: "ready", kind, buffer, mimeType });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [enabled, offer, profileId, reloadKey]);

  return state;
}

export function buildArtifactDownloadBlob(
  offer: ArtifactOfferPayload,
  content: Extract<ArtifactContentState, { status: "ready" }>,
): Blob {
  if (content.text !== undefined) {
    return new Blob([content.text], { type: content.mimeType });
  }
  if (content.buffer) {
    return new Blob([content.buffer], { type: content.mimeType });
  }
  throw new Error("Nothing to download.");
}
