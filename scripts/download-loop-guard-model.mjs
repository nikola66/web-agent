#!/usr/bin/env node
/**
 * Download Xenova/mobilebert-uncased-mnli (quantized ONNX) into public/models/loop-guard/.
 * Re-run when bumping the Loop Guard model version.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Xenova/mobilebert-uncased-mnli";
const REV = "main";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/models/loop-guard");

const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.txt",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

async function download(relPath) {
  const url = `https://huggingface.co/${REPO}/resolve/${REV}/${relPath}`;
  const dest = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`✓ ${relPath} (${(buf.length / 1024 / 1024).toFixed(2)} MiB)`);
}

for (const file of FILES) {
  await download(file);
}
console.log(`\nLoop Guard model ready at ${path.relative(ROOT, OUT)}/`);
