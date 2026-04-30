import fs from "node:fs/promises";
import path from "node:path";

const TYPES = new Set(["tools", "channels", "providers", "skills"]);

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function listType(root, type) {
  const base = path.join(root, type);
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const manifest = await readJson(path.join(dir, "manifest.json"));
    if (type === "skills") {
      rows.push({ id: entry.name, path: path.relative(process.cwd(), dir) });
    } else if (manifest?.id) {
      rows.push({
        id: manifest.id,
        name: manifest.name || manifest.id,
        description: manifest.description || "",
        path: path.relative(process.cwd(), dir),
      });
    }
  }
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export async function run(args = {}) {
  const requested = String(args.type || "").trim();
  const types = requested && TYPES.has(requested) ? [requested] : [...TYPES];
  const root = path.join(process.cwd(), ".webagent", "capabilities");
  const out = {};
  for (const type of types) {
    out[type] = await listType(root, type);
  }
  return { ok: true, capabilities: out };
}
