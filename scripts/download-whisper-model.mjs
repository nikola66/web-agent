#!/usr/bin/env node
/**
 * Download Xenova/whisper-tiny.en (q4f16 ONNX) into public/models/whisper-tiny-en/.
 * Re-run when bumping the STT model version.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Xenova/whisper-tiny.en";
const REV = "main";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/models/whisper-tiny-en");

const FILES = [
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
];

async function download(relPath) {
  const url = `https://huggingface.co/${REPO}/resolve/${REV}/${relPath}`;
  const dest = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await fs.promises.access(dest);
    process.stdout.write(`✓ already present: ${relPath}\n`);
    return;
  } catch {
    /* fall through */
  }
  process.stdout.write(`↓ ${relPath} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  process.stdout.write(`${(buf.length / 1024 / 1024).toFixed(2)} MiB\n`);
}

for (const file of FILES) {
  await download(file);
}
console.log(`\nWhisper STT model ready at ${path.relative(ROOT, OUT)}/`);
