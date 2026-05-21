import { listWorkspaceFiles, type WorkspaceFileEntry } from "@/core/workspace";
import {
  buildWorkspaceFileIndexEntry,
  type WorkspaceFileIndex,
  type WorkspaceFileIndexEntry,
} from "@/core/workspace-file-search";

export type { WorkspaceFileIndex, WorkspaceFileIndexEntry } from "@/core/workspace-file-search";
export { searchWorkspaceFiles } from "@/core/workspace-file-search";

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { index: WorkspaceFileIndex; inFlight: Promise<WorkspaceFileIndex> | null }>();

function buildIndex(profileId: string, files: WorkspaceFileEntry[]): WorkspaceFileIndex {
  const entries: WorkspaceFileIndexEntry[] = [];
  for (const file of files) {
    const indexed = buildWorkspaceFileIndexEntry(file);
    if (indexed) entries.push(indexed);
  }
  entries.sort((a, b) => {
    const aTime = a.lastModified ?? 0;
    const bTime = b.lastModified ?? 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.path.localeCompare(b.path);
  });
  return { profileId, entries, fetchedAt: Date.now() };
}

async function fetchIndex(profileId: string): Promise<WorkspaceFileIndex> {
  const files = await listWorkspaceFiles(profileId, { preferLive: true });
  return buildIndex(profileId, files);
}

export function invalidateWorkspaceFileIndex(profileId?: string): void {
  if (profileId) {
    cache.delete(profileId);
    return;
  }
  cache.clear();
}

export async function getWorkspaceFileIndex(
  profileId: string,
  options: { force?: boolean } = {}
): Promise<WorkspaceFileIndex> {
  const existing = cache.get(profileId);
  const fresh =
    existing &&
    !options.force &&
    Date.now() - existing.index.fetchedAt < CACHE_TTL_MS;

  if (fresh) return existing.index;

  if (existing?.inFlight && !options.force) {
    return existing.inFlight;
  }

  const inFlight = fetchIndex(profileId).then((index) => {
    cache.set(profileId, { index, inFlight: null });
    return index;
  });

  cache.set(profileId, {
    index: existing?.index ?? { profileId, entries: [], fetchedAt: 0 },
    inFlight,
  });

  return inFlight;
}
