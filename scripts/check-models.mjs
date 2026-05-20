#!/usr/bin/env node
/**
 * Build-time sanity check: confirms the ML model trees committed to the
 * repo are intact before Vite builds the production bundle.
 *
 * The Whisper-tiny tree is shipped with the repository (alongside the
 * Loop-Guard model), so a `git clone && npm run build` produces a fully
 * functional STT pipeline without any network access. If a contributor
 * accidentally deletes the tree, or git-lfs is later introduced and a
 * pull is forgotten, this script fails fast with a single actionable
 * message instead of letting the broken artifact reach production.
 *
 * Re-run standalone via `npm run check:models`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each entry lists the relative model directory and the files that must
 * be present inside it. The lists mirror the FILES arrays in the
 * corresponding `scripts/download-*.mjs` refresh scripts.
 */
const MODELS = [
  {
    label: "kokoro-82m",
    dir: "public/models/onnx-community/Kokoro-82M-v1.0-ONNX",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "onnx/model_q8f16.onnx",
      "voices/af_bella.bin",
    ],
    refreshHint: "npm run download:kokoro && git add public/models/onnx-community && git commit",
  },
  {
    label: "loop-guard",
    dir: "public/models/loop-guard",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "vocab.txt",
      "special_tokens_map.json",
      "onnx/model_q4f16.onnx",
    ],
    refreshHint: "npm run download:loop-guard-model && git add public/models/loop-guard && git commit",
  },
  {
    label: "whisper-tiny-en",
    dir: "public/models/whisper-tiny-en",
    files: [
      "config.json",
      "generation_config.json",
      "preprocessor_config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "added_tokens.json",
      "merges.txt",
      "normalizer.json",
      "special_tokens_map.json",
      "vocab.json",
      "quant_config.json",
      "quantize_config.json",
      "onnx/encoder_model_q4f16.onnx",
      "onnx/decoder_model_merged_q4f16.onnx",
    ],
    refreshHint: "npm run download:whisper && git add public/models/whisper-tiny-en && git commit",
  },
];

const failures = [];

for (const model of MODELS) {
  const absDir = path.join(repoRoot, model.dir);
  const missing = [];
  for (const rel of model.files) {
    const abs = path.join(absDir, rel);
    if (!fs.existsSync(abs)) missing.push(rel);
  }
  if (missing.length === 0) {
    process.stdout.write(`✓ ${model.label}\n`);
  } else {
    failures.push({ ...model, missing });
  }
}

if (failures.length === 0) process.exit(0);

process.stderr.write("\nMissing model files — production build aborted.\n\n");
for (const { label, dir, missing, refreshHint } of failures) {
  process.stderr.write(`  ${label} (${dir})\n`);
  for (const rel of missing) process.stderr.write(`    - ${rel}\n`);
  process.stderr.write(`    → ${refreshHint}\n\n`);
}
process.stderr.write(
  "These files are tracked in the repo and ship with every deploy. If you only need to bypass the check temporarily, run vite directly (not recommended).\n"
);
process.exit(1);
