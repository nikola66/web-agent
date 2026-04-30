/**
 * OPFS-backed filesystem persistence layer.
 *
 * Provides a POSIX-like interface over the Origin Private File System,
 * with debounced auto-save and quota monitoring.
 */

export interface FileEntry {
  path: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
}

/** Request durable storage (prevents browser eviction under pressure) */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}

/** Get storage quota information */
export async function getStorageEstimate(): Promise<{
  used: number;
  quota: number;
  percentage: number;
}> {
  if (navigator.storage?.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      used: usage,
      quota,
      percentage: quota > 0 ? (usage / quota) * 100 : 0,
    };
  }
  return { used: 0, quota: 0, percentage: 0 };
}

function deleteIndexedDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (!name || typeof indexedDB === "undefined") {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, 2000);

    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = finish;
      request.onerror = finish;
      request.onblocked = () => {
        // Active connections can block until reload. Treat as best-effort so the
        // caller can continue with a page reload, which releases this page's DBs.
      };
    } catch {
      finish();
    }
  });
}

/** Delete all IndexedDB databases for this origin. */
export async function clearIndexedDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string | null }>>;
  };

  if (typeof factory.databases === "function") {
    const databases = await factory.databases().catch(() => []);
    for (const db of databases) {
      if (db.name) await deleteIndexedDatabase(db.name);
    }
    return;
  }

  await deleteIndexedDatabase("keyval-store");
}

/** Remove every OPFS root entry for this origin. */
export async function clearOriginPrivateFileSystem(): Promise<void> {
  if (!navigator.storage?.getDirectory) return;
  const root = await getRoot();
  for await (const [name] of root as any) {
    try {
      await root.removeEntry(name, { recursive: true });
    } catch {
      /* best-effort */
    }
  }
}

/** Delete Cache Storage entries for this origin. */
export async function clearCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys().catch(() => []);
  for (const name of names) {
    await caches.delete(name).catch(() => false);
  }
}

/** Unregister service workers so they cannot repopulate caches mid-wipe. */
export async function unregisterServiceWorkers(): Promise<void> {
  if (!navigator.serviceWorker?.getRegistrations) return;
  const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
  for (const reg of regs) {
    await reg.unregister().catch(() => false);
  }
}

/**
 * Clear app-managed and runtime-managed browser storage for this origin.
 *
 * navigator.storage.estimate() reports total origin usage, not just workspace
 * snapshots, so full cleanup must include IndexedDB/Cache Storage as well as
 * OPFS.
 */
export async function clearAllOriginStorage(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }

  await unregisterServiceWorkers();
  await clearCacheStorage();
  await clearOriginPrivateFileSystem();
  await clearIndexedDatabases();
}

/** Get the OPFS root directory */
async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/** Navigate to a directory handle by path, optionally creating intermediaries */
async function navigateTo(
  path: string,
  create = false
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  let dir = await getRoot();
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

/** Get parent directory and filename from a full path */
function splitPath(path: string): { parent: string; name: string } {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop()!;
  return { parent: parts.join("/"), name };
}

// ── File Operations ─────────────────────────────────────────────────

/** Write a file to OPFS */
export async function writeFile(path: string, data: string | ArrayBuffer | Uint8Array): Promise<void> {
  const { parent, name } = splitPath(path);
  const dir = await navigateTo(parent, true);
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  // Normalize Uint8Array to ArrayBuffer to satisfy strict OPFS types
  const payload = data instanceof Uint8Array ? data.buffer.slice(0) : data;
  await writable.write(payload as string | ArrayBuffer);
  await writable.close();
}

/** Read a file from OPFS as text */
export async function readFile(path: string): Promise<string> {
  const { parent, name } = splitPath(path);
  const dir = await navigateTo(parent);
  const fileHandle = await dir.getFileHandle(name);
  const file = await fileHandle.getFile();
  return file.text();
}

/** Read a file from OPFS as ArrayBuffer */
export async function readFileBuffer(path: string): Promise<ArrayBuffer> {
  const { parent, name } = splitPath(path);
  const dir = await navigateTo(parent);
  const fileHandle = await dir.getFileHandle(name);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/** Check if a file or directory exists */
export async function exists(path: string): Promise<boolean> {
  try {
    const { parent, name } = splitPath(path);
    const dir = await navigateTo(parent);
    // Try file first, then directory
    try {
      await dir.getFileHandle(name);
      return true;
    } catch {
      await dir.getDirectoryHandle(name);
      return true;
    }
  } catch {
    return false;
  }
}

/** Create a directory (and all parent directories) */
export async function mkdir(path: string): Promise<void> {
  await navigateTo(path, true);
}

/** List entries in a directory */
export async function listDir(path: string): Promise<FileEntry[]> {
  const dir = await navigateTo(path);
  const entries: FileEntry[] = [];

  for await (const [name, handle] of dir as any) {
    const entry: FileEntry = {
      path: path ? `${path}/${name}` : name,
      kind: handle.kind,
    };
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      entry.size = file.size;
      entry.lastModified = file.lastModified;
    }
    entries.push(entry);
  }

  return entries;
}

/** Remove a file */
export async function removeFile(path: string): Promise<void> {
  const { parent, name } = splitPath(path);
  const dir = await navigateTo(parent);
  await dir.removeEntry(name);
}

/** Remove a directory recursively */
export async function removeDir(path: string): Promise<void> {
  const { parent, name } = splitPath(path);
  const dir = await navigateTo(parent);
  await dir.removeEntry(name, { recursive: true });
}

/** Remove all OPFS data for a given root prefix */
export async function clearAll(prefix: string): Promise<void> {
  const normalized = prefix.split("/").filter(Boolean).join("/");
  if (!normalized) return;
  const { parent, name } = splitPath(normalized);
  try {
    const dir = parent ? await navigateTo(parent) : await getRoot();
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // Directory didn't exist
  }
}

// ── Snapshot (for agent filesystem) ──────────────────────────

export interface SnapshotEntry {
  path: string;
  content: string | ArrayBuffer;
}

/** Export all files under a prefix as a flat list */
export async function exportSnapshot(prefix: string): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];

  async function walk(dir: FileSystemDirectoryHandle, currentPath: string) {
    for await (const [name, handle] of dir as any) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name;
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        const content = await file.arrayBuffer();
        entries.push({ path: fullPath, content });
      } else {
        await walk(handle as FileSystemDirectoryHandle, fullPath);
      }
    }
  }

  try {
    const dir = await navigateTo(prefix);
    await walk(dir, "");
  } catch {
    // Prefix doesn't exist yet
  }

  return entries;
}

/** Import a flat list of files under a prefix */
export async function importSnapshot(
  prefix: string,
  entries: SnapshotEntry[]
): Promise<void> {
  for (const entry of entries) {
    await writeFile(`${prefix}/${entry.path}`, entry.content);
  }
}
