/**
 * Surfacing applied migrations to the user.
 *
 * Three sinks, all best-effort. A failure in one does not block the others:
 *   1. The agent terminal (`process.stdout`) — colorized banner shown right
 *      after bootstrap so the user notices on next interaction.
 *   2. Configured side-channels (Telegram today) — a one-shot message
 *      addressed to the allowed user id so off-tab users still find out.
 *   3. The rolling session memory log — gives the model first-class context
 *      next turn ("the workspace was migrated on …").
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import { dim, pink } from "../terminal-format.js";
import { logDebugEvent } from "../logging/debug-log.js";
import type { RunMigrationsSummary, AppliedMigrationSummaryEntry } from "./runner.js";

const SESSION_MEMORY_REL = ".webagent/session-memory.jsonl";

function formatTerminalBanner(applied: AppliedMigrationSummaryEntry[]): string {
  const lines: string[] = [];
  lines.push(pink("▸ Workspace migrations applied"));
  for (const entry of applied) {
    lines.push(dim(`  • ${entry.id} — ${entry.description}`));
    if (entry.note) lines.push(dim(`    ${entry.note}`));
  }
  lines.push(dim("  Recorded in .webagent/migrations.json"));
  return lines.join("\n") + "\n";
}

function formatChannelMessage(applied: AppliedMigrationSummaryEntry[]): string {
  const header = `🛠️ Web Agent applied ${applied.length} workspace migration${
    applied.length === 1 ? "" : "s"
  } on first load:`;
  const body = applied
    .map((entry) => {
      const note = entry.note ? `\n    ${entry.note}` : "";
      return `• ${entry.id} — ${entry.description}${note}`;
    })
    .join("\n");
  return `${header}\n${body}\nLedger: .webagent/migrations.json`;
}

async function appendSessionMemoryNotice(applied: AppliedMigrationSummaryEntry[]): Promise<void> {
  const path = workspaceStatePath(SESSION_MEMORY_REL);
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  const row = {
    ts: new Date().toISOString(),
    kind: "note",
    text: `Workspace migrations applied: ${applied
      .map((entry) => `${entry.id} (${entry.description})`)
      .join("; ")}.`,
    ref: "migrations",
  };
  let existing = "";
  try {
    existing = await fs.readFile(path, "utf8");
  } catch {
    /* new file */
  }
  const lines = existing.split("\n").filter((line) => line.trim());
  lines.push(JSON.stringify(row));
  await fs.writeFile(path, lines.slice(-50).join("\n") + "\n", "utf8");
}

async function broadcastToTelegram(applied: AppliedMigrationSummaryEntry[]): Promise<void> {
  const token = String(process.env.WEBAGENT_TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return;
  let chatId: string | null = null;
  try {
    const { loadTelegramAllowedUserId } = await import("../channels/telegram.js");
    const allowed = await loadTelegramAllowedUserId();
    if (allowed) chatId = String(allowed);
  } catch {
    return;
  }
  if (!chatId) return;
  try {
    const { sendTelegramMessage } = await import("../channels/telegram.js");
    let msg = formatChannelMessage(applied);
    if (msg.length > 4096) msg = `${msg.slice(0, 4090)}…`;
    await sendTelegramMessage(token, chatId, msg);
  } catch {
    /* best effort */
  }
}

export async function notifyMigrationsApplied(
  summary: RunMigrationsSummary,
  onOutput: (chunk: string) => void
): Promise<void> {
  if (!summary.applied.length) return;

  try {
    onOutput(formatTerminalBanner(summary.applied));
  } catch {
    /* terminal sink optional */
  }

  await Promise.allSettled([
    appendSessionMemoryNotice(summary.applied),
    broadcastToTelegram(summary.applied),
  ]);

  await logDebugEvent("migrations_user_notified", {
    appliedIds: summary.applied.map((entry) => entry.id),
  });
}
