/**
 * HTTP-based email tooling (send only).
 * Send: Resend REST API (no TCP needed).
 *
 * On Nodebox (browser sandbox), direct fetch() to api.resend.com often fails with
 * "Failed to fetch" (CORS / sandbox networking). Same-origin /api/proxy via ipc
 * matches web_fetch fallback — see remote-tools.js `proxyRequest`.
 */

import { ipcProxyRequest } from "../ipc.js";
import { gateToolExecution, summarizeToolApproval } from "./tool-policy.js";

const EMAIL_MUTATING = new Set(["send"]);

function readEmailEnv(env) {
  const e = env ?? process.env;
  return {
    resendApiKey: String(e.WEBAGENT_RESEND_API_KEY ?? "").trim(),
    resendFrom: String(e.WEBAGENT_RESEND_FROM ?? "").trim(),
  };
}

function missingResend(cfg) {
  if (!cfg.resendApiKey)
    return "Resend is not configured. Set Settings → Email (Resend API key).";
  return null;
}

function isNodeboxRuntime() {
  return String(process.env.WEBAGENT_RUNTIME ?? "").trim() === "nodebox";
}

/** POST https://api.resend.com/emails — direct fetch on host Node, IPC proxy in Nodebox. */
async function postResendEmails(cfg, emailPayload) {
  const url = "https://api.resend.com/emails";
  const headers = {
    Authorization: `Bearer ${cfg.resendApiKey}`,
    "Content-Type": "application/json",
  };
  const serialized = JSON.stringify(emailPayload);

  if (isNodeboxRuntime()) {
    const payload = await ipcProxyRequest({
      method: "POST",
      url,
      headers,
      body: serialized,
    });
    if (payload?.error) {
      throw new Error(String(payload.error));
    }
    const status = Number(payload?.status ?? 0);
    const bodyText = String(payload?.body ?? "");
    if (!Number.isFinite(status) || status <= 0) {
      throw new Error(
        `Resend send failed (proxy): unexpected response ${JSON.stringify(payload).slice(0, 240)}`
      );
    }
    if (status < 200 || status >= 300) {
      let err = {};
      try {
        err = JSON.parse(bodyText);
      } catch {
        /* ignore */
      }
      throw new Error(
        `Resend send failed (${status}): ${err.message ?? bodyText.slice(0, 200)}`
      );
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error(`Resend send: invalid JSON response (${bodyText.slice(0, 200)})`);
    }
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: serialized,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(
      `Resend send failed (${resp.status}): ${err.message ?? JSON.stringify(err).slice(0, 200)}`
    );
  }
  return resp.json();
}

export function inferEmailActionArgument(args) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? { ...args } : {};
  const actionStr =
    a.action === undefined || a.action === null ? "" : String(a.action).trim();
  if (actionStr) return a;
  const to = String(a.to ?? "").trim();
  const subject = String(a.subject ?? "").trim();
  const text = String(a.text ?? "");
  if (to && subject && text.trim()) {
    a.action = "send";
  }
  return a;
}

export async function emailTool(args = {}, ctx) {
  const enrichedArgs = inferEmailActionArgument(args);
  const cfg = readEmailEnv(ctx?.env);
  const action = String(enrichedArgs?.action ?? "").trim();

  const mutating = EMAIL_MUTATING.has(action);
  if (mutating) {
    const ok = await gateToolExecution({
      ctx,
      toolLabel: `email:${action}`,
      summary: summarizeToolApproval(`email:${action}`, enrichedArgs),
      args: enrichedArgs,
      risky: true,
    });
    if (!ok) throw new Error("user_denied");
  }

  switch (action) {
    case "self_test": {
      return {
        ok: true,
        send: {
          provider: "resend",
          configured: !missingResend(cfg),
        },
        notes: [missingResend(cfg) ?? "Resend configured."],
      };
    }

    case "send": {
      const ms = missingResend(cfg);
      if (ms) throw new Error(ms);
      const to = String(enrichedArgs?.to ?? "").trim();
      const subject = String(enrichedArgs?.subject ?? "").trim();
      const text = String(enrichedArgs?.text ?? "");
      if (!to) throw new Error("`to` is required for send.");
      if (!subject) throw new Error("`subject` is required for send.");
      if (!text.trim()) throw new Error("`text` is required for send.");
      const from =
        typeof enrichedArgs?.from === "string" && enrichedArgs.from.trim()
          ? enrichedArgs.from.trim()
          : cfg.resendFrom || "agent@resend.dev";

      const body = { from, to, subject, text };
      if (typeof enrichedArgs?.html === "string") body.html = enrichedArgs.html;

      const result = await postResendEmails(cfg, body);
      return { ok: true, id: result.id };
    }

    default:
      throw new Error("`action` must be one of self_test, send.");
  }
}
