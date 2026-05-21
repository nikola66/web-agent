/**
 * Lightweight persisted embedding index for memory facts (feature hashing).
 */

import fs from "node:fs/promises";
import { memoryStatePath } from "../constants.js";

const INDEX_REL = "fact-embeddings.json";
const EMBED_DIMS = 256;
const MIN_SEMANTIC_SCORE = 0.08;

type EmbeddingRecord = {
  vector: number[];
  updated_at: string;
};

type EmbeddingStore = Record<string, EmbeddingRecord>;

function indexPath(): string {
  return memoryStatePath(INDEX_REL);
}

async function loadStore(): Promise<EmbeddingStore> {
  try {
    const raw = await fs.readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStore(store: EmbeddingStore): Promise<void> {
  await fs.mkdir(memoryStatePath(""), { recursive: true });
  await fs.writeFile(indexPath(), JSON.stringify(store, null, 2), "utf8");
}

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 1)
    .slice(0, 128);
}

function hashToken(token: string, dim: number): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dim;
}

export function embedText(text: string): number[] {
  const vec = new Array<number>(EMBED_DIMS).fill(0);
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    vec[hashToken(token, EMBED_DIMS)] += 1;
    if (i > 0) {
      const bigram = `${tokens[i - 1]}_${token}`;
      vec[hashToken(bigram, EMBED_DIMS)] += 0.5;
    }
  }
  let norm = 0;
  for (let i = 0; i < EMBED_DIMS; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return vec.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
}

function factDocument(key: string, value: unknown): string {
  return `${String(key || "").trim()} ${JSON.stringify(value)}`;
}

export async function upsertFactEmbedding(key: string, value: unknown): Promise<void> {
  const factKey = String(key || "").trim();
  if (!factKey) return;
  const store = await loadStore();
  store[factKey] = {
    vector: embedText(factDocument(factKey, value)),
    updated_at: new Date().toISOString(),
  };
  await saveStore(store);
}

export async function removeFactEmbedding(key: string): Promise<void> {
  const factKey = String(key || "").trim();
  if (!factKey) return;
  const store = await loadStore();
  if (!store[factKey]) return;
  delete store[factKey];
  await saveStore(store);
}

export async function searchFactEmbeddings(
  query: string,
  limit = 30
): Promise<Array<{ key: string; score: number }>> {
  const q = String(query || "").trim();
  if (!q) return [];
  const store = await loadStore();
  const queryVec = embedText(q);
  const scored = Object.entries(store)
    .map(([key, record]) => ({
      key,
      score: cosineSimilarity(queryVec, record.vector || []),
    }))
    .filter((row) => row.score >= MIN_SEMANTIC_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
  return scored;
}
