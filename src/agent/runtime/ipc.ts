/**
 * IPC proxy bridge — lets agent make HTTP requests through the adapter
 * (browser page context) rather than from inside the sandbox, bypassing
 * the sandbox's localhost isolation.
 *
 * Flow:
 *   agent stdout  → <<<WEBAGENT_PROXY_REQ:id>>>{request}<<<END_WEBAGENT_PROXY_REQ>>>
 *   adapter       → fetch("/api/proxy") on the browser page (same-origin)
 *   adapter stdin → <<<WEBAGENT_PROXY_RESP:id>>>{response}<<<END_WEBAGENT_PROXY_RESP>>>
 */

export const IPC_PROXY_REQ_PREFIX = "<<<WEBAGENT_PROXY_REQ:";
export const IPC_PROXY_REQ_END = "<<<END_WEBAGENT_PROXY_REQ>>>";
export const IPC_PROXY_RESP_PREFIX = "<<<WEBAGENT_PROXY_RESP:";
export const IPC_PROXY_RESP_END = "<<<END_WEBAGENT_PROXY_RESP>>>";
export const IPC_PROXY_STREAM_REQ_PREFIX = "<<<WEBAGENT_PROXY_STREAM_REQ:";
export const IPC_PROXY_STREAM_REQ_END = "<<<END_WEBAGENT_PROXY_STREAM_REQ>>>";
export const IPC_PROXY_STREAM_START_PREFIX = "<<<WEBAGENT_PROXY_STREAM_START:";
export const IPC_PROXY_STREAM_START_END = "<<<END_WEBAGENT_PROXY_STREAM_START>>>";
export const IPC_PROXY_STREAM_CHUNK_PREFIX = "<<<WEBAGENT_PROXY_STREAM_CHUNK:";
export const IPC_PROXY_STREAM_CHUNK_END = "<<<END_WEBAGENT_PROXY_STREAM_CHUNK>>>";
export const IPC_PROXY_STREAM_END_PREFIX = "<<<WEBAGENT_PROXY_STREAM_END:";
export const IPC_PROXY_STREAM_END_END = "<<<END_WEBAGENT_PROXY_STREAM_END>>>";

/** Adapter-hosted spawn — avoids broken `child_process.spawn` inside Nodebox sandbox. */
export const IPC_SPAWN_REQ_PREFIX = "<<<WEBAGENT_SPAWN_REQ:";
export const IPC_SPAWN_REQ_END = "<<<END_WEBAGENT_SPAWN_REQ>>>";
export const IPC_SPAWN_RESP_PREFIX = "<<<WEBAGENT_SPAWN_RESP:";
export const IPC_SPAWN_RESP_END = "<<<END_WEBAGENT_SPAWN_RESP>>>";

let _nextId = 0;
const _pending = new Map(); // id → { resolve, reject, timer }
let _streamNextId = 0;
const _streamPending = new Map(); // id → { resolve, reject, onStart, onChunk, timer }

let _spawnNextId = 0;
const _spawnPending = new Map(); // id → { resolve, reject, timer }

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function decodePayload(payload) {
  return JSON.parse(Buffer.from(String(payload || ""), "base64").toString("utf8"));
}

function stripSpawnResponses(text) {
  const re = new RegExp(
    IPC_SPAWN_RESP_PREFIX.replace(/</g, "<") + "([^>]+)>>>" + "([\\s\\S]*?)" + IPC_SPAWN_RESP_END,
    "g"
  );
  return text.replace(re, (_, id, payload) => {
    const entry = _spawnPending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      _spawnPending.delete(id);
      try {
        entry.resolve(JSON.parse(payload));
      } catch (e) {
        entry.reject(new Error(`IPC spawn response parse error: ${e?.message || e}`));
      }
    }
    return "";
  });
}

function stripProxyResponses(text) {
  const re = new RegExp(
    IPC_PROXY_RESP_PREFIX.replace(/</g, "<") + "([^>]+)>>>" + "([\\s\\S]*?)" + IPC_PROXY_RESP_END,
    "g"
  );
  return text.replace(re, (_, id, payload) => {
    const entry = _pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      _pending.delete(id);
      try {
        entry.resolve(JSON.parse(payload));
      } catch (e) {
        entry.reject(new Error(`IPC proxy response parse error: ${e?.message || e}`));
      }
    }
    return "";
  });
}

function stripStreamResponses(text) {
  const parseEvent = (input, prefix, suffix, handler) => {
    const re = new RegExp(
      prefix.replace(/</g, "<") + "([^>]+)>>>" + "([A-Za-z0-9+/=]+?)" + suffix,
      "g"
    );
    return input.replace(re, (_, id, payload) => {
      const entry = _streamPending.get(id);
      if (!entry) return "";
      try {
        handler(entry, decodePayload(payload), id);
      } catch (e) {
        clearTimeout(entry.timer);
        _streamPending.delete(id);
        entry.reject(new Error(`IPC proxy stream parse error: ${e?.message || e}`));
      }
      return "";
    });
  };

  let out = parseEvent(text, IPC_PROXY_STREAM_START_PREFIX, IPC_PROXY_STREAM_START_END, (entry, payload) => {
    entry.onStart?.(payload);
  });
  out = parseEvent(out, IPC_PROXY_STREAM_CHUNK_PREFIX, IPC_PROXY_STREAM_CHUNK_END, (entry, payload) => {
    entry.onChunk?.(String(payload?.chunk ?? ""));
  });
  out = parseEvent(out, IPC_PROXY_STREAM_END_PREFIX, IPC_PROXY_STREAM_END_END, (entry, payload, id) => {
    clearTimeout(entry.timer);
    _streamPending.delete(id);
    if (payload?.error) {
      entry.reject(new Error(String(payload.error)));
      return;
    }
    entry.resolve(payload);
  });
  return out;
}

/**
 * Strip any IPC proxy/spawn response markers from a stdin chunk, resolving
 * pending requests. Returns the remaining text (user input).
 * Called from agent.js stdin data handler.
 */
export function processStdinChunk(text) {
  let out = stripSpawnResponses(text);
  out = stripStreamResponses(out);
  out = stripProxyResponses(out);
  return out;
}

/**
 * Send a proxy request via IPC and wait for the adapter to fulfill it.
 * The adapter makes the actual fetch from the browser page context.
 */
export function ipcProxyRequest(request) {
  return new Promise((resolve, reject) => {
    const id = String(++_nextId);
    const timer = setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        reject(new Error("IPC proxy request timed out after 30s."));
      }
    }, 30_000);
    _pending.set(id, { resolve, reject, timer });
    process.stdout.write(
      `${IPC_PROXY_REQ_PREFIX}${id}>>>${JSON.stringify(request)}${IPC_PROXY_REQ_END}`
    );
  });
}

export function ipcProxyStreamRequest(
  request,
  {
    timeoutMs = 300_000,
    signal = null,
    onStart,
    onChunk,
  }: {
    timeoutMs?: number;
    signal?: AbortSignal | null;
    onStart?: (payload: unknown) => void;
    onChunk?: (chunk: string) => void;
  } = {}
) {
  return new Promise((resolve, reject) => {
    const id = String(++_streamNextId);
    const abort = () => {
      if (!_streamPending.has(id)) return;
      clearTimeout(timer);
      _streamPending.delete(id);
      reject(new Error("IPC proxy stream aborted"));
    };
    const timer = setTimeout(() => {
      if (_streamPending.has(id)) {
        _streamPending.delete(id);
        reject(new Error(`IPC proxy stream timed out after ${timeoutMs}ms.`));
      }
    }, timeoutMs);
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error("IPC proxy stream aborted"));
      return;
    }
    signal?.addEventListener?.("abort", abort, { once: true });
    _streamPending.set(id, {
      resolve: (payload) => {
        signal?.removeEventListener?.("abort", abort);
        resolve(payload);
      },
      reject: (error) => {
        signal?.removeEventListener?.("abort", abort);
        reject(error);
      },
      onStart,
      onChunk,
      timer,
    });
    process.stdout.write(
      `${IPC_PROXY_STREAM_REQ_PREFIX}${id}>>>${encodePayload(request)}${IPC_PROXY_STREAM_REQ_END}`
    );
  });
}

/**
 * Run a subprocess via the browser adapter using Nodebox shell (same as agent spawn).
 * Only used when `WEBAGENT_RUNTIME=nodebox` — child_process.spawn is unreliable there.
 */
export function ipcSpawnRequest(payload) {
  return new Promise((resolve, reject) => {
    const id = String(++_spawnNextId);
    const waitMs = Math.min(
      typeof payload.timeout_ms === "number" &&
        Number.isFinite(payload.timeout_ms) &&
        payload.timeout_ms > 0
        ? payload.timeout_ms + 15_000
        : 135_000,
      600_000
    );
    const timer = setTimeout(() => {
      if (_spawnPending.has(id)) {
        _spawnPending.delete(id);
        reject(new Error(`IPC spawn request timed out after ${waitMs}ms.`));
      }
    }, waitMs);
    _spawnPending.set(id, { resolve, reject, timer });
    process.stdout.write(
      `${IPC_SPAWN_REQ_PREFIX}${id}>>>${JSON.stringify(payload)}${IPC_SPAWN_REQ_END}`
    );
  });
}
