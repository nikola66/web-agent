/**
 * Fact storage in database.
 */

import { getDb, persistDb } from "./sql.js";

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
  const q = String(query || "").toLowerCase();
  const capped = Math.max(1, Math.min(100, Number(limit || 30)));
  const facts = await getAllFacts();
  return facts
    .filter((fact) => JSON.stringify(fact).toLowerCase().includes(q))
    .slice(0, capped);
}
