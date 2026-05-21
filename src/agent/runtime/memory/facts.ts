/**
 * Fact storage in database.
 */

import { getDb, persistDb } from "./sql.js";
import { searchFactEmbeddings, upsertFactEmbedding } from "./semantic-index.js";

function parseFactValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function factRows(db, sql, params = []) {
  const result = db.exec(sql, params);
  const rows = result[0]?.values || [];
  return rows.map(([key, value, createdAt, updatedAt]) => ({
    key,
    value: parseFactValue(value),
    created_at: createdAt,
    updated_at: updatedAt,
  }));
}

function substringScore(fact, query) {
  const haystack = JSON.stringify(fact).toLowerCase();
  const q = String(query || "").toLowerCase();
  if (!q) return 0;
  if (haystack.includes(q)) return 1;
  const tokens = q.split(/\W+/).filter((token) => token.length > 1);
  if (!tokens.length) return 0;
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits / tokens.length;
}

export async function setFact(key, value) {
  const factKey = String(key || "").trim();
  if (!factKey) throw new Error("`key` is required for memory_save.");
  const db = await getDb();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO facts(key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [factKey, JSON.stringify(value), now, now]
  );
  await persistDb(db, true);
  await upsertFactEmbedding(factKey, value).catch(() => {});
  return { key: factKey, value, created_at: now, updated_at: now };
}

export async function getFact(key) {
  const factKey = String(key || "").trim();
  if (!factKey) return null;
  const db = await getDb();
  return factRows(
    db,
    "SELECT key, value, created_at, updated_at FROM facts WHERE key = ? LIMIT 1",
    [factKey]
  )[0] || null;
}

export async function getAllFacts(limit = 0) {
  const db = await getDb();
  const cap = Math.round(Number(limit) || 0);
  const sql =
    cap > 0
      ? `SELECT key, value, created_at, updated_at FROM facts ORDER BY updated_at DESC, key ASC LIMIT ${cap}`
      : "SELECT key, value, created_at, updated_at FROM facts ORDER BY updated_at DESC, key ASC";
  return factRows(db, sql);
}

export async function searchFacts(query, limit = 30) {
  const q = String(query || "").trim();
  const capped = Math.max(1, Math.min(100, Number(limit || 30)));
  if (!q) return [];

  const facts = await getAllFacts();
  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  const merged = new Map();

  for (const fact of facts) {
    const score = substringScore(fact, q);
    if (score <= 0) continue;
    merged.set(fact.key, {
      ...fact,
      _match_score: score,
      _match_source: "substring",
    });
  }

  const semanticHits = await searchFactEmbeddings(q, capped).catch(() => []);
  for (const hit of semanticHits) {
    const fact = byKey.get(hit.key);
    if (!fact) continue;
    const prev = merged.get(hit.key);
    const semanticScore = Number(hit.score || 0);
    if (!prev || semanticScore > prev._match_score) {
      merged.set(hit.key, {
        ...fact,
        _match_score: Math.max(prev?._match_score || 0, semanticScore),
        _match_source: prev ? "hybrid" : "semantic",
      });
    } else if (prev && prev._match_source === "substring") {
      merged.set(hit.key, { ...prev, _match_source: "hybrid" });
    }
  }

  return [...merged.values()]
    .sort((a, b) => {
      const scoreDiff = (b._match_score || 0) - (a._match_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    })
    .slice(0, capped);
}

export async function searchFactsForContext(query, limit = 12) {
  const rows = await searchFacts(query, limit);
  return rows.map(({ _match_score, _match_source, ...fact }) => fact);
}
