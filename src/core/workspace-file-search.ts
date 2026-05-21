import { inferArtifactKind, type ArtifactKind } from "@/core/artifact-preview";
import type { WorkspaceFileEntry } from "@/core/workspace";

export type WorkspaceFileIndexEntry = WorkspaceFileEntry & {
  basename: string;
  basenameLower: string;
  pathLower: string;
  kind: ArtifactKind;
};

export type WorkspaceFileIndex = {
  profileId: string;
  entries: WorkspaceFileIndexEntry[];
  fetchedAt: number;
};

function scoreMatch(entry: WorkspaceFileIndexEntry, queryLower: string): number {
  if (!queryLower) return 0;
  const { basenameLower, pathLower } = entry;
  if (basenameLower === queryLower) return 100;
  if (basenameLower.startsWith(queryLower)) return 80;
  if (basenameLower.includes(queryLower)) return 60;
  if (pathLower.includes(queryLower)) return 40;
  const segments = pathLower.split("/");
  if (segments.some((seg) => seg.startsWith(queryLower))) return 30;
  return -1;
}

export function searchWorkspaceFiles(
  index: WorkspaceFileIndex,
  query: string,
  limit = 20
): WorkspaceFileIndexEntry[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    return index.entries.slice(0, limit);
  }

  const scored: { entry: WorkspaceFileIndexEntry; score: number }[] = [];
  for (const entry of index.entries) {
    const score = scoreMatch(entry, q);
    if (score >= 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.entry.path.length !== b.entry.path.length) {
      return a.entry.path.length - b.entry.path.length;
    }
    const aTime = a.entry.lastModified ?? 0;
    const bTime = b.entry.lastModified ?? 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.entry.path.localeCompare(b.entry.path);
  });

  return scored.slice(0, limit).map((row) => row.entry);
}

export function buildWorkspaceFileIndexEntry(entry: WorkspaceFileEntry): WorkspaceFileIndexEntry | null {
  if (entry.path.endsWith("/")) return null;
  const parts = entry.path.split("/");
  const base = parts[parts.length - 1] ?? entry.path;
  return {
    ...entry,
    basename: base,
    basenameLower: base.toLowerCase(),
    pathLower: entry.path.toLowerCase(),
    kind: inferArtifactKind(entry.path),
  };
}
