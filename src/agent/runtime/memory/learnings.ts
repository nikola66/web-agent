/**
 * Learnings from agent runs in database.
 */

import { getDb, persistDb } from "./sql.js";

export type PromoteLearningOptions = {
  category?: string;
  statement?: string;
  confidence?: number;
  sourceRunId?: string | null;
  evidence?: Record<string, unknown> | null;
};

export async function promoteLearning({
  category,
  statement,
  confidence = 0.6,
  sourceRunId = null,
  evidence = null,
}: PromoteLearningOptions = {}) {
  const normalizedCategory = String(category || "").trim();
  const normalizedStatement = String(statement || "").trim();
  if (!normalizedCategory || !normalizedStatement) return null;
  const now = new Date().toISOString();
  const boundedConfidence = Math.max(0, Math.min(1, Number(confidence) || 0));
  const db = await getDb();
  db.run(
    `INSERT INTO learnings(category, statement, confidence, evidence_count, contradicted, source_run_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)
     ON CONFLICT(category, statement) DO UPDATE SET
       confidence = (learnings.confidence * learnings.evidence_count + excluded.confidence) / (learnings.evidence_count + 1),
       evidence_count = learnings.evidence_count + 1,
       source_run_id = COALESCE(excluded.source_run_id, learnings.source_run_id),
       metadata = COALESCE(excluded.metadata, learnings.metadata),
       updated_at = excluded.updated_at`,
    [
      normalizedCategory,
      normalizedStatement,
      boundedConfidence,
      sourceRunId || null,
      evidence ? JSON.stringify(evidence) : null,
      now,
      now,
    ]
  );
  await persistDb(db);
  return {
    category: normalizedCategory,
    statement: normalizedStatement,
    confidence: boundedConfidence,
  };
}

export async function getPromotableLearnings(limit = 8) {
  const capped = Math.max(1, Math.min(40, Number(limit || 8)));
  const db = await getDb();
  const result = db.exec(
    `SELECT category, statement, confidence, evidence_count, source_run_id, updated_at
     FROM learnings
     WHERE contradicted = 0
     ORDER BY evidence_count DESC, confidence DESC, updated_at DESC
     LIMIT ?`,
    [capped]
  );
  return (result?.[0]?.values || []).map(
    ([category, statement, confidence, evidenceCount, sourceRunId, updatedAt]) => ({
      category,
      statement,
      confidence: Number(confidence || 0),
      evidence_count: Number(evidenceCount || 0),
      source_run_id: sourceRunId || null,
      updated_at: updatedAt || null,
    })
  );
}
