/**
 * Bidirectional sync between Nodebox's ephemeral filesystem and OPFS.
 * Snapshots are keyed by profile id: profiles/{id}/snapshot/...
 */

import { getNodebox } from "./boot";
import {
  writeFile,
  readFileBuffer,
  listDir,
  mkdir,
  exists,
} from "@/core/persistence";
import {
  snapshotPrefix,
  WORKSPACE_WEBAGENT_USER_FILES,
  WORKSPACE_WEBAGENT_USER_SUBDIRS,
} from "@/core/workspace";

export interface SyncOptions {
  onProgress?: (path: string) => void;
}

/** Check whether any snapshot root exists for the profile */
export async function hasWorkspaceSnapshot(profileId: string): Promise<boolean> {
  return exists(snapshotPrefix(profileId));
}

/** Save selected paths from Nodebox into OPFS under the profile snapshot */
export async function saveFilesystem(
  profileId: string,
  paths: string[],
  options: SyncOptions = {}
): Promise<void> {
  const emulator = await getNodebox();
  const prefix = snapshotPrefix(profileId);
  const workspaceDir = `/workspace/${profileId}`;

  for (const filePath of paths) {
    try {
      const file = await emulator.fs.readFile(filePath);
      const relPath = filePath.startsWith(`${workspaceDir}/`)
        ? filePath.slice(workspaceDir.length + 1)
        : filePath.replace(/^\/+/, "");
      await writeFile(`${prefix}/${relPath}`, file);
      options.onProgress?.(filePath);
    } catch {
      // File may have been deleted; skip
    }
  }
}

/** Recursively export everything under /workspace/{profileId} from Nodebox to OPFS. */
export async function saveWorkspaceSnapshot(
  profileId: string,
  options: SyncOptions = {}
): Promise<void> {
  const emulator = await getNodebox();
  const prefix = snapshotPrefix(profileId);
  const workspaceDir = `/workspace/${profileId}`;

  async function exportFile(abs: string): Promise<void> {
    try {
      const buf = await emulator.fs.readFile(abs);
      const relPath = abs.startsWith(`${workspaceDir}/`)
        ? abs.slice(workspaceDir.length + 1)
        : abs.replace(/^\/+/, "");
      await writeFile(`${prefix}/${relPath}`, buf);
      options.onProgress?.(abs);
    } catch {
      /* skip unreadable / missing files */
    }
  }

  async function walk(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await emulator.fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = `${dir}/${name}`;
      let isDir = false;
      try {
        const stat = await emulator.fs.stat(abs);
        isDir = stat.type === "dir";
      } catch {
        continue;
      }
      if (isDir) {
        // Runtime under `.webagent/` is re-seeded on every launch; only persist user-owned paths.
        if (abs === `${workspaceDir}/.webagent`) {
          for (const sub of WORKSPACE_WEBAGENT_USER_SUBDIRS) {
            await walk(`${abs}/${sub}`);
          }
          for (const rel of WORKSPACE_WEBAGENT_USER_FILES) {
            await exportFile(`${workspaceDir}/${rel}`);
          }
          continue;
        }
        if (abs === `${workspaceDir}/memory/snapshots`) continue;
        const relPath = abs.startsWith(`${workspaceDir}/`)
          ? abs.slice(workspaceDir.length + 1)
          : abs.replace(/^\/+/, "");
        if (relPath) {
          await mkdir(`${prefix}/${relPath}`);
        }
        await walk(abs);
      } else {
        await exportFile(abs);
      }
    }
  }

  await walk(workspaceDir);
}

/** Restore a saved filesystem snapshot into Nodebox at /workspace/{profileId} */
export async function restoreFilesystem(
  profileId: string,
  options: SyncOptions = {}
): Promise<boolean> {
  const prefix = snapshotPrefix(profileId);

  const snapshotExists = await exists(prefix);
  if (!snapshotExists) return false;

  const emulator = await getNodebox();
  const targetBase = `/workspace/${profileId}`;

  function normalizeSnapshotRelativePath(rawPath: string): string {
    let rel = rawPath.startsWith(`${prefix}/`)
      ? rawPath.slice(prefix.length + 1)
      : rawPath;
    rel = rel.replace(/^\/+/, "");
    return rel;
  }

  async function walk(dir: string): Promise<void> {
    const entries = await listDir(dir);
    for (const entry of entries) {
      const relPath = normalizeSnapshotRelativePath(entry.path);
      const targetPath = relPath ? `${targetBase}/${relPath}` : targetBase;

      if (entry.kind === "directory") {
        if (relPath) await emulator.fs.mkdir(targetPath, { recursive: true });
        await walk(entry.path);
      } else {
        const data = await readFileBuffer(entry.path);
        const parentDir = targetPath.split("/").slice(0, -1).join("/");
        await emulator.fs.mkdir(parentDir, { recursive: true });
        await emulator.fs.writeFile(targetPath, new Uint8Array(data));
        options.onProgress?.(targetPath);
      }
    }
  }

  await walk(prefix);
  return true;
}

/** Write a batch of files into Nodebox (used for initial seeding) */
export async function mountInitialFilesystem(
  files: Record<string, string>
): Promise<void> {
  const emulator = await getNodebox();
  for (const [path, contents] of Object.entries(files)) {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await emulator.fs.mkdir(dir, { recursive: true });
    await emulator.fs.writeFile(path, contents);
  }
}

/** Write a single file into Nodebox */
export async function wcWriteFile(
  path: string,
  contents: string | Uint8Array
): Promise<void> {
  const emulator = await getNodebox();
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir) await emulator.fs.mkdir(dir, { recursive: true });
  await emulator.fs.writeFile(path, contents);
}

/** Read a single file from Nodebox */
export async function wcReadFile(path: string): Promise<string> {
  const emulator = await getNodebox();
  const buf = await emulator.fs.readFile(path);
  return new TextDecoder().decode(buf);
}

/** Ensure profile snapshot root exists in OPFS (empty workspace bootstrap) */
export async function ensureSnapshotRoot(profileId: string): Promise<void> {
  await mkdir(snapshotPrefix(profileId));
}
