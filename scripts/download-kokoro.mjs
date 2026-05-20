#!/usr/bin/env node
/**
 * Maintainer-only refresh script for the Kokoro-82M TTS model.
 *
 * **The deploy pipeline does not need this.** Files are tracked in git
 * under `public/models/onnx-community/Kokoro-82M-v1.0-ONNX/` and ship
 * with every checkout — production builds verify their presence via
 * `npm run check:models` and never reach the network for them.
 *
 * Run this only when the upstream Kokoro revision needs to be refreshed:
 *
 *   1. `npm run download:kokoro`
 *   2. `git add public/models/onnx-community && git commit -m "refresh kokoro tts"`
 *
 * Quantization: q4 dtype (~50 MB) — best speed/quality/size tradeoff for
 * a single bundled voice. The agent loads from disk at runtime; no
 * remote model fetch ever happens during use.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const HF_BASE = `https://huggingface.co/${REPO}/resolve/main`;
const TARGET_DIR = path.join(repoRoot, "public/models", REPO);

/** Files kokoro-js requests at load time + a single bundled voice. */
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_q8f16.onnx",
  "voices/af_bella.bin",
];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadOne(relPath) {
  const url = `${HF_BASE}/${relPath}`;
  const dest = path.join(TARGET_DIR, relPath);
  await ensureDir(path.dirname(dest));

  try {
    await fs.access(dest);
    process.stdout.write(`✓ already present: ${relPath}\n`);
    return;
  } catch {
    /* fall through */
  }

  process.stdout.write(`↓ ${relPath} … `);
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404 && /(tokenizer_config|special_tokens_map)\.json$/.test(relPath)) {
      process.stdout.write("optional (404 — skip)\n");
      return;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buffer);
  process.stdout.write(`${(buffer.byteLength / 1024 / 1024).toFixed(2)} MiB\n`);
}

async function main() {
  process.stdout.write(`Downloading ${REPO} into ${path.relative(repoRoot, TARGET_DIR)}\n`);
  await ensureDir(TARGET_DIR);
  for (const file of FILES) {
    await downloadOne(file);
  }
  process.stdout.write("Done. Voice TTS can now run fully locally.\n");
}

main().catch((err) => {
  process.stderr.write(`Failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
