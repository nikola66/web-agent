import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Copy, RefreshCw } from "lucide-react";
import {
  loadAgentMemorySnapshot,
  type AgentMemorySnapshot,
  type CronJobEntry,
  type MemoryFact,
  type MemoryLearning,
  type MemoryReflection,
  type SessionMemoryEntry,
} from "@/core/agent-memory";

type MemorySection =
  | "overview"
  | "facts"
  | "learnings"
  | "session"
  | "reflections"
  | "jobs";

const SECTIONS: Array<{ id: MemorySection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "facts", label: "Facts" },
  { id: "learnings", label: "Learnings" },
  { id: "session", label: "Session" },
  { id: "reflections", label: "Reflections" },
  { id: "jobs", label: "Jobs" },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isStaleFact(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(updated)) return false;
  return Date.now() - updated > 90 * 86_400_000;
}

function matchesSearch(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

function factSearchText(fact: MemoryFact): string {
  return `${fact.key} ${JSON.stringify(fact.value)} ${fact.updated_at ?? ""}`;
}

function learningSearchText(learning: MemoryLearning): string {
  return `${learning.category} ${learning.statement} ${learning.source_run_id ?? ""}`;
}

function sessionSearchText(entry: SessionMemoryEntry): string {
  return `${entry.kind ?? ""} ${entry.text ?? ""} ${entry.ref ?? ""} ${entry.artifact_path ?? ""}`;
}

function reflectionSearchText(reflection: MemoryReflection): string {
  return `${reflection.path} ${reflection.what_worked ?? ""} ${reflection.what_failed ?? ""} ${
    reflection.improvement ?? ""
  }`;
}

function cronJobToolSummary(job: CronJobEntry): string {
  if (job.steps && job.steps.length > 0) {
    return job.steps.map((step) => step.tool).join(" → ");
  }
  return job.tool ?? "—";
}

function cronJobSearchText(job: CronJobEntry): string {
  return [
    job.id,
    job.delivery,
    job.tool ?? "",
    (job.steps ?? []).map((step) => step.tool).join(" "),
    job.notifyChannel ?? "",
    job.deliveryEmailTo ?? "",
    job.deliveryEmailSubject ?? "",
    job.enabled ? "enabled" : "disabled",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatEpochMs(value: number | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return "never";
  return new Date(value).toLocaleString();
}

function formatEveryMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} h`;
  if (minutes < 60 * 24) return `${hours.toFixed(1)} h`;
  const days = minutes / (60 * 24);
  return Number.isInteger(days) ? `${days} d` : `${days.toFixed(1)} d`;
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(251,117,252,0.18)" : "transparent",
    color: active ? "rgb(248,231,255)" : "rgba(255,255,255,0.65)",
  };
}

export function MemoryTab({
  profileId,
  refreshKey,
}: {
  profileId: string;
  refreshKey: number;
}) {
  const [snapshot, setSnapshot] = useState<AgentMemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<MemorySection>("overview");
  const [search, setSearch] = useState("");
  const [selectedReflectionIndex, setSelectedReflectionIndex] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadAgentMemorySnapshot(profileId);
      setSnapshot(next);
      setSelectedReflectionIndex(0);
      setSelectedJobId(next.cronJobs[0]?.id ?? null);
    } catch (err) {
      console.error("Failed to load agent memory:", err);
      setSnapshot(null);
      setError("Failed to load memory.");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot, refreshKey]);

  const trimmedSearch = search.trim();
  const filteredFacts = useMemo(() => {
    if (!snapshot) return [];
    if (!trimmedSearch) return snapshot.facts;
    return snapshot.facts.filter((fact) => matchesSearch(factSearchText(fact), trimmedSearch));
  }, [snapshot, trimmedSearch]);

  const filteredLearnings = useMemo(() => {
    if (!snapshot) return [];
    if (!trimmedSearch) return snapshot.learnings;
    return snapshot.learnings.filter((learning) =>
      matchesSearch(learningSearchText(learning), trimmedSearch)
    );
  }, [snapshot, trimmedSearch]);

  const filteredSessionEntries = useMemo(() => {
    if (!snapshot) return [];
    if (!trimmedSearch) return snapshot.sessionEntries;
    return snapshot.sessionEntries.filter((entry) =>
      matchesSearch(sessionSearchText(entry), trimmedSearch)
    );
  }, [snapshot, trimmedSearch]);

  const filteredReflections = useMemo(() => {
    if (!snapshot) return [];
    if (!trimmedSearch) return snapshot.reflections;
    return snapshot.reflections.filter((reflection) =>
      matchesSearch(reflectionSearchText(reflection), trimmedSearch)
    );
  }, [snapshot, trimmedSearch]);

  const filteredJobs = useMemo(() => {
    if (!snapshot) return [];
    if (!trimmedSearch) return snapshot.cronJobs;
    return snapshot.cronJobs.filter((job) =>
      matchesSearch(cronJobSearchText(job), trimmedSearch)
    );
  }, [snapshot, trimmedSearch]);

  const selectedReflection = filteredReflections[selectedReflectionIndex] ?? null;
  const selectedCronJob = useMemo(() => {
    if (!snapshot || !selectedJobId) return null;
    return snapshot.cronJobs.find((job) => job.id === selectedJobId) ?? null;
  }, [snapshot, selectedJobId]);

  const hasAnyMemory = useMemo(() => {
    if (!snapshot) return false;
    return (
      snapshot.facts.length > 0 ||
      snapshot.learnings.length > 0 ||
      snapshot.toolStats.length > 0 ||
      snapshot.sessionEntries.length > 0 ||
      snapshot.reflections.length > 0 ||
      snapshot.cronJobs.length > 0 ||
      snapshot.archives.conversations.count > 0 ||
      snapshot.archives.runs.count > 0 ||
      snapshot.archives.jobs.count > 0 ||
      snapshot.archives.snapshots.count > 0
    );
  }, [snapshot]);

  const copyPayload = useMemo(() => {
    if (!snapshot) return null;
    if (section === "facts") return filteredFacts;
    if (section === "learnings") return filteredLearnings;
    if (section === "session") return filteredSessionEntries;
    if (section === "reflections") return filteredReflections;
    if (section === "jobs") {
      return {
        cronJobs: filteredJobs,
        selected: selectedCronJob ?? null,
      };
    }
    return {
      loadedAt: snapshot.loadedAt,
      warnings: snapshot.warnings,
      counts: {
        facts: snapshot.facts.length,
        learnings: snapshot.learnings.length,
        toolStats: snapshot.toolStats.length,
        sessionEntries: snapshot.sessionEntries.length,
        reflections: snapshot.reflections.length,
        cronJobs: snapshot.cronJobs.length,
      },
      archives: snapshot.archives,
    };
  }, [
    filteredFacts,
    filteredJobs,
    filteredLearnings,
    filteredReflections,
    filteredSessionEntries,
    section,
    selectedCronJob,
    snapshot,
  ]);

  const copyVisible = useCallback(async () => {
    if (!copyPayload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(copyPayload, null, 2));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1500);
    }
  }, [copyPayload]);

  return (
    <div className="flex h-[420px] min-h-0 min-w-0 flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-[#f8e7ff]">AGENT MEMORY</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted">
            {snapshot ? formatTimestamp(snapshot.loadedAt) : "—"}
          </span>
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            className="rounded-sm p-1 text-text-muted transition-colors hover:text-text-primary"
            aria-label="Refresh memory"
            title="Refresh memory"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search memory..."
          className="min-w-[180px] flex-1 rounded-sm border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-text-secondary outline-none focus:border-[#fb75fc4d]"
        />
        <button
          type="button"
          onClick={() => void copyVisible()}
          disabled={!copyPayload}
          className="inline-flex items-center gap-1 rounded-sm border border-white/15 bg-white/5 px-2 py-1 text-[10px] text-text-secondary transition-colors hover:border-white/25 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Copy size={10} aria-hidden />
          {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy JSON"}
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className="rounded-sm px-2 py-1 text-[11px] transition-colors"
            style={tabButtonStyle(section === item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[11px] text-text-muted">Loading memory...</p>
      ) : error ? (
        <p className="text-[11px] text-red-300">{error}</p>
      ) : !snapshot ? (
        <p className="text-[11px] text-text-muted">No memory snapshot available.</p>
      ) : (
        <>
          {snapshot.warnings.length > 0 ? (
            <div className="mb-2 space-y-1 rounded-sm border border-amber-400/20 bg-amber-400/5 px-2 py-1.5">
              {snapshot.warnings.map((warning) => (
                <p key={warning} className="text-[10px] text-amber-200">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {!hasAnyMemory ? (
            <p className="text-[11px] text-text-muted">
              No persistent memory yet. Facts and session notes appear after the agent uses memory
              tools or completes runs.
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto border border-white/10 p-2">
            {section === "overview" ? (
              <div className="grid grid-cols-2 gap-2">
                <OverviewCard label="Facts" value={String(snapshot.facts.length)} />
                <OverviewCard label="Learnings" value={String(snapshot.learnings.length)} />
                <OverviewCard label="Tool stats" value={String(snapshot.toolStats.length)} />
                <OverviewCard label="Session notes" value={String(snapshot.sessionEntries.length)} />
                <OverviewCard label="Reflections" value={String(snapshot.reflections.length)} />
                <OverviewCard label="Cron jobs" value={String(snapshot.cronJobs.length)} />
                <OverviewCard
                  label="SQLite"
                  value={snapshot.sqliteBytes == null ? "missing" : formatBytes(snapshot.sqliteBytes)}
                />
                <OverviewCard
                  label="Snapshots"
                  value={`${snapshot.archives.snapshots.count} files`}
                />
                <ArchiveCard title="Conversations" index={snapshot.archives.conversations} />
                <ArchiveCard title="Runs" index={snapshot.archives.runs} />
                <ArchiveCard title="Job logs" index={snapshot.archives.jobs} />
                {snapshot.toolStats.length > 0 ? (
                  <div className="col-span-2 rounded-sm border border-white/10 bg-white/[0.03] px-2 py-2">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                      Tool stats
                    </p>
                    <div className="space-y-1">
                      {snapshot.toolStats.slice(0, 12).map((stat) => (
                        <p key={stat.tool_name} className="text-[10px] text-text-secondary">
                          {stat.tool_name}: {stat.success_count} success, {stat.failure_count} failure
                          {stat.last_used ? ` · ${formatTimestamp(stat.last_used)}` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {section === "facts" ? (
              filteredFacts.length === 0 ? (
                <EmptySection message="No facts match the current filter." />
              ) : (
                <div className="space-y-2">
                  {filteredFacts.map((fact) => (
                    <div
                      key={fact.key}
                      className="rounded-sm border border-white/10 bg-white/[0.03] p-2"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] font-medium text-[#f8e7ff]">{fact.key}</p>
                        <p className="shrink-0 text-[10px] text-text-muted">
                          {formatTimestamp(fact.updated_at)}
                          {isStaleFact(fact.updated_at) ? " · stale" : ""}
                        </p>
                      </div>
                      <pre className="whitespace-pre-wrap wrap-break-word text-[10px] text-text-secondary">
                        {JSON.stringify(fact.value, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )
            ) : null}

            {section === "learnings" ? (
              filteredLearnings.length === 0 ? (
                <EmptySection message="No learnings match the current filter." />
              ) : (
                <div className="space-y-2">
                  {filteredLearnings.map((learning) => (
                    <div
                      key={`${learning.category}:${learning.statement}`}
                      className="rounded-sm border border-white/10 bg-white/[0.03] p-2"
                    >
                      <p className="text-[10px] uppercase tracking-[0.12em] text-brand-magenta-light">
                        {learning.category}
                      </p>
                      <p className="mt-1 text-[11px] text-text-secondary">{learning.statement}</p>
                      <p className="mt-1 text-[10px] text-text-muted">
                        confidence {learning.confidence.toFixed(2)} · evidence {learning.evidence_count}
                        {learning.updated_at ? ` · ${formatTimestamp(learning.updated_at)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )
            ) : null}

            {section === "session" ? (
              filteredSessionEntries.length === 0 ? (
                <EmptySection message="No session notes match the current filter." />
              ) : (
                <div className="space-y-2">
                  {filteredSessionEntries.map((entry, index) => (
                    <div
                      key={`${entry.ts ?? "entry"}-${index}`}
                      className="rounded-sm border border-white/10 bg-white/[0.03] p-2"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-text-secondary">
                          {entry.kind ?? "note"}
                        </span>
                        <span className="text-[10px] text-text-muted">{formatTimestamp(entry.ts)}</span>
                      </div>
                      {entry.parse_error ? (
                        <p className="text-[11px] text-amber-200">{entry.line}</p>
                      ) : (
                        <p className="text-[11px] text-text-secondary">{entry.text}</p>
                      )}
                      {entry.ref ? (
                        <p className="mt-1 text-[10px] text-text-muted">ref: {entry.ref}</p>
                      ) : null}
                      {entry.artifact_path ? (
                        <p className="mt-1 text-[10px] text-text-muted">
                          artifact: {entry.artifact_path}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )
            ) : null}

            {section === "reflections" ? (
              filteredReflections.length === 0 ? (
                <EmptySection message="No reflections match the current filter." />
              ) : (
                <div className="grid min-h-0 grid-rows-[1fr_auto] gap-2">
                  <div className="space-y-1 overflow-auto">
                    {filteredReflections.map((reflection, index) => (
                      <button
                        key={reflection.path}
                        type="button"
                        onClick={() => setSelectedReflectionIndex(index)}
                        className="block w-full rounded-sm border border-white/10 px-2 py-1.5 text-left"
                        style={{
                          background:
                            index === selectedReflectionIndex
                              ? "rgba(251,117,252,0.18)"
                              : "rgba(255,255,255,0.03)",
                        }}
                      >
                        <p className="truncate text-[10px] text-text-muted">{reflection.path}</p>
                        <p className="text-[11px] text-text-secondary">
                          {reflection.what_worked || reflection.what_failed || reflection.improvement
                            ? `worked=${reflection.what_worked || "n/a"} · failed=${
                                reflection.what_failed || "n/a"
                              }`
                            : "Reflection"}
                        </p>
                      </button>
                    ))}
                  </div>
                  <div className="border border-white/10 p-2">
                    <p className="mb-1 text-[10px] text-text-muted">Selected reflection</p>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap wrap-break-word text-[10px] text-text-secondary">
                      {selectedReflection
                        ? JSON.stringify(selectedReflection.raw, null, 2)
                        : "Select a reflection to inspect details."}
                    </pre>
                  </div>
                </div>
              )
            ) : null}

            {section === "jobs" ? (
              snapshot.cronJobs.length === 0 ? (
                <EmptySection message="No cron jobs registered. Use cron_register (writes .cronjobs.json) to schedule recurring work." />
              ) : filteredJobs.length === 0 ? (
                <EmptySection message="No cron jobs match the current filter." />
              ) : (
                <div className="grid min-h-0 grid-cols-[220px_1fr] gap-2">
                  <div className="space-y-1 overflow-auto border-r border-white/10 pr-2">
                    {filteredJobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        className="block w-full rounded-sm px-2 py-1.5 text-left"
                        style={{
                          background:
                            selectedJobId === job.id
                              ? "rgba(251,117,252,0.18)"
                              : "transparent",
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[10px] text-[#f8e7ff]">{job.id}</p>
                          <span
                            className="shrink-0 rounded-sm px-1 py-0.5 text-[9px] uppercase tracking-[0.08em]"
                            style={{
                              background: job.enabled
                                ? "rgba(110,231,183,0.15)"
                                : "rgba(255,255,255,0.08)",
                              color: job.enabled
                                ? "rgb(167,243,208)"
                                : "rgba(255,255,255,0.5)",
                            }}
                          >
                            {job.enabled ? "on" : "off"}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-text-muted">
                          every {formatEveryMinutes(job.everyMinutes)} · {job.delivery}
                        </p>
                        <p className="truncate text-[10px] text-text-muted">
                          {cronJobToolSummary(job)}
                        </p>
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 overflow-auto">
                    {selectedCronJob ? (
                      <div className="space-y-2">
                        <div className="rounded-sm border border-white/10 bg-white/[0.03] p-2">
                          <p className="text-[11px] font-medium text-[#f8e7ff]">
                            {selectedCronJob.id}
                          </p>
                          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                            <span>
                              schedule: every {formatEveryMinutes(selectedCronJob.everyMinutes)}
                            </span>
                            <span>delivery: {selectedCronJob.delivery}</span>
                            <span>
                              enabled: {selectedCronJob.enabled ? "yes" : "no"}
                            </span>
                            <span>
                              last run: {formatEpochMs(selectedCronJob.lastRunAt)}
                            </span>
                            {selectedCronJob.retryCount != null ? (
                              <span>
                                retry: {selectedCronJob.retryAttempts ?? 0}/
                                {selectedCronJob.retryCount}
                                {selectedCronJob.retryDelayMinutes
                                  ? ` · ${selectedCronJob.retryDelayMinutes}m delay`
                                  : ""}
                              </span>
                            ) : null}
                            {selectedCronJob.nextRetryAt &&
                            selectedCronJob.nextRetryAt > 0 ? (
                              <span>
                                next retry: {formatEpochMs(selectedCronJob.nextRetryAt)}
                              </span>
                            ) : null}
                            {selectedCronJob.notifyChannel ? (
                              <span>notify: {selectedCronJob.notifyChannel}</span>
                            ) : null}
                            {selectedCronJob.deliveryEmailTo ? (
                              <span>email to: {selectedCronJob.deliveryEmailTo}</span>
                            ) : null}
                            {selectedCronJob.deliveryEmailSubject ? (
                              <span className="col-span-2 truncate">
                                subject: {selectedCronJob.deliveryEmailSubject}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-sm border border-white/10 bg-white/[0.03] p-2">
                          <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                            {selectedCronJob.steps && selectedCronJob.steps.length > 0
                              ? `Steps (${selectedCronJob.steps.length})`
                              : "Tool"}
                          </p>
                          {selectedCronJob.steps && selectedCronJob.steps.length > 0 ? (
                            <ol className="space-y-1 text-[10px] text-text-secondary">
                              {selectedCronJob.steps.map((step, index) => (
                                <li
                                  key={`${step.tool}-${index}`}
                                  className="rounded-sm border border-white/10 bg-black/20 px-2 py-1"
                                >
                                  <p className="text-[10px] text-[#f8e7ff]">
                                    {index + 1}. {step.tool}
                                  </p>
                                  {step.arguments && Object.keys(step.arguments).length > 0 ? (
                                    <pre className="mt-1 whitespace-pre-wrap wrap-break-word text-[10px] text-text-secondary">
                                      {JSON.stringify(step.arguments, null, 2)}
                                    </pre>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <div className="text-[10px] text-text-secondary">
                              <p className="text-[10px] text-[#f8e7ff]">
                                {selectedCronJob.tool ?? "—"}
                              </p>
                              {selectedCronJob.arguments &&
                              Object.keys(selectedCronJob.arguments).length > 0 ? (
                                <pre className="mt-1 whitespace-pre-wrap wrap-break-word text-[10px] text-text-secondary">
                                  {JSON.stringify(selectedCronJob.arguments, null, 2)}
                                </pre>
                              ) : null}
                            </div>
                          )}
                        </div>

                        <div className="rounded-sm border border-white/10 bg-white/[0.03] p-2">
                          <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                            Raw entry
                          </p>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word text-[10px] text-text-secondary">
                            {JSON.stringify(selectedCronJob.raw, null, 2)}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-text-muted">
                        Select a cron job to inspect its schedule and steps.
                      </p>
                    )}
                  </div>
                </div>
              )
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function OverviewCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-white/10 bg-white/[0.03] px-2 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-1 text-[12px] text-[#f8e7ff]">{value}</p>
    </div>
  );
}

function ArchiveCard({
  title,
  index,
}: {
  title: string;
  index: { count: number; totalBytes: number; latestPaths: string[] };
}) {
  return (
    <div className="col-span-2 rounded-sm border border-white/10 bg-white/[0.03] px-2 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">{title}</p>
      <p className="mt-1 text-[12px] text-[#f8e7ff]">
        {index.count} files · {formatBytes(index.totalBytes)}
      </p>
      {index.latestPaths.length > 0 ? (
        <p className="mt-1 text-[10px] text-text-muted">
          Latest: {index.latestPaths.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return <p className="text-[11px] text-text-muted">{message}</p>;
}
