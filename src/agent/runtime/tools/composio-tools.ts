import fs from "node:fs/promises";
import nodePath from "node:path";
import { ipcProxyRequest } from "../ipc.js";
import { workspaceStatePath, COMPOSIO_AUDIT_REL } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";
import { createTimeoutController } from "./context.js";
import { gateToolExecution, summarizeToolApproval } from "./tool-policy.js";

type ToolArgs = Record<string, unknown>;

type MarketingAction = {
  app: string;
  actionId: string;
  kind: "read" | "draft" | "write" | "send" | "publish";
  targetFields: string[];
};

const DEFAULT_V3_BASE_URL = "https://backend.composio.dev/api/v3";
const ACTION_LOG_REL = COMPOSIO_AUDIT_REL;

const MARKETING_ACTIONS: Record<string, MarketingAction> = {
  google_calendar_list_events: {
    app: "googlecalendar",
    actionId: "GOOGLECALENDAR_EVENTS_LIST",
    kind: "read",
    targetFields: ["calendar_id", "time_min", "time_max", "query"],
  },
  google_calendar_get_event: {
    app: "googlecalendar",
    actionId: "GOOGLECALENDAR_EVENTS_GET",
    kind: "read",
    targetFields: ["calendar_id", "event_id"],
  },
  google_calendar_create_event: {
    app: "googlecalendar",
    actionId: "GOOGLECALENDAR_CREATE_EVENT",
    kind: "write",
    targetFields: ["calendar_id", "summary", "start_datetime", "end_datetime"],
  },
  google_calendar_patch_event: {
    app: "googlecalendar",
    actionId: "GOOGLECALENDAR_PATCH_EVENT",
    kind: "write",
    targetFields: ["calendar_id", "event_id", "summary", "start_datetime", "end_datetime"],
  },
  google_calendar_delete_event: {
    app: "googlecalendar",
    actionId: "GOOGLECALENDAR_DELETE_EVENT",
    kind: "write",
    targetFields: ["calendar_id", "event_id"],
  },
  google_calendar_find_free_slots: {
    app: "googlecalendar",
    actionId: "GOOGLECALENDAR_FIND_FREE_SLOTS",
    kind: "read",
    targetFields: ["calendar_id", "time_min", "time_max"],
  },

  gmail_fetch_emails: {
    app: "gmail",
    actionId: "GMAIL_FETCH_EMAILS",
    kind: "read",
    targetFields: ["query", "max_results"],
  },
  gmail_list_drafts: {
    app: "gmail",
    actionId: "GMAIL_LIST_DRAFTS",
    kind: "read",
    targetFields: ["query"],
  },
  gmail_create_draft: {
    app: "gmail",
    actionId: "GMAIL_CREATE_EMAIL_DRAFT",
    kind: "draft",
    targetFields: ["recipient_email", "subject"],
  },
  gmail_send_draft: {
    app: "gmail",
    actionId: "GMAIL_SEND_DRAFT",
    kind: "send",
    targetFields: ["draft_id"],
  },
  gmail_send_email: {
    app: "gmail",
    actionId: "GMAIL_SEND_EMAIL",
    kind: "send",
    targetFields: ["recipient_email", "subject"],
  },
  gmail_add_label_to_email: {
    app: "gmail",
    actionId: "GMAIL_ADD_LABEL_TO_EMAIL",
    kind: "write",
    targetFields: ["message_id"],
  },

  googlesheets_batch_get: {
    app: "googlesheets",
    actionId: "GOOGLESHEETS_BATCH_GET",
    kind: "read",
    targetFields: ["spreadsheet_id", "ranges"],
  },
  googlesheets_values_get: {
    app: "googlesheets",
    actionId: "GOOGLESHEETS_VALUES_GET",
    kind: "read",
    targetFields: ["spreadsheet_id", "range"],
  },
  googlesheets_spreadsheets_values_append: {
    app: "googlesheets",
    actionId: "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
    kind: "write",
    targetFields: ["spreadsheet_id", "range"],
  },
  googlesheets_values_update: {
    app: "googlesheets",
    actionId: "GOOGLESHEETS_VALUES_UPDATE",
    kind: "write",
    targetFields: ["spreadsheet_id", "range"],
  },
  googlesheets_create_spreadsheet_row: {
    app: "googlesheets",
    actionId: "GOOGLESHEETS_CREATE_SPREADSHEET_ROW",
    kind: "write",
    targetFields: ["spreadsheet_id", "sheet_name"],
  },
  googlesheets_upsert_rows: {
    app: "googlesheets",
    actionId: "GOOGLESHEETS_UPSERT_SPREADSHEET_ROW",
    kind: "write",
    targetFields: ["spreadsheet_id", "sheet_name"],
  },

  x_search_recent: {
    app: "twitter",
    actionId: "TWITTER_RECENT_SEARCH",
    kind: "read",
    targetFields: ["query"],
  },
  x_create_post: {
    app: "twitter",
    actionId: "TWITTER_CREATION_OF_A_POST",
    kind: "publish",
    targetFields: ["text"],
  },
  x_list_post_likers: {
    app: "twitter",
    actionId: "TWITTER_LIST_POST_LIKERS",
    kind: "read",
    targetFields: ["post_id"],
  },

  linkedin_create_post: {
    app: "linkedin",
    actionId: "LINKEDIN_CREATE_LINKED_IN_POST",
    kind: "publish",
    targetFields: ["text"],
  },
  linkedin_create_article_or_url_share: {
    app: "linkedin",
    actionId: "LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE",
    kind: "publish",
    targetFields: ["text", "url"],
  },
  linkedin_get_my_info: {
    app: "linkedin",
    actionId: "LINKEDIN_GET_MY_INFO",
    kind: "read",
    targetFields: [],
  },

  instagram_get_user_info: {
    app: "instagram",
    actionId: "INSTAGRAM_GET_USER_INFO",
    kind: "read",
    targetFields: [],
  },
  instagram_get_user_media: {
    app: "instagram",
    actionId: "INSTAGRAM_GET_IG_USER_MEDIA",
    kind: "read",
    targetFields: ["user_id"],
  },
  instagram_post_media: {
    app: "instagram",
    actionId: "INSTAGRAM_POST_IG_USER_MEDIA",
    kind: "publish",
    targetFields: ["caption", "image_url", "video_url"],
  },
  instagram_publish_media: {
    app: "instagram",
    actionId: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
    kind: "publish",
    targetFields: ["creation_id"],
  },
  instagram_send_text_message: {
    app: "instagram",
    actionId: "INSTAGRAM_SEND_TEXT_MESSAGE",
    kind: "send",
    targetFields: ["recipient_id", "text"],
  },
  instagram_send_image: {
    app: "instagram",
    actionId: "INSTAGRAM_SEND_IMAGE",
    kind: "send",
    targetFields: ["recipient_id", "image_url", "text"],
  },

  hubspot_search_contacts: {
    app: "hubspot",
    actionId: "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
    kind: "read",
    targetFields: ["query", "email"],
  },
  hubspot_create_contact: {
    app: "hubspot",
    actionId: "HUBSPOT_CREATE_CONTACT",
    kind: "write",
    targetFields: ["email"],
  },
  hubspot_update_contact: {
    app: "hubspot",
    actionId: "HUBSPOT_UPDATE_CONTACT",
    kind: "write",
    targetFields: ["contact_id", "email"],
  },

  notion_search: {
    app: "notion",
    actionId: "NOTION_SEARCH_NOTION_PAGE",
    kind: "read",
    targetFields: ["query"],
  },
  notion_create_page: {
    app: "notion",
    actionId: "NOTION_CREATE_NOTION_PAGE",
    kind: "write",
    targetFields: ["parent_id", "title"],
  },
  slack_send_message: {
    app: "slack",
    actionId: "SLACK_CHAT_POST_MESSAGE",
    kind: "send",
    targetFields: ["channel", "text"],
  },
  youtube_search: {
    app: "youtube",
    actionId: "YOUTUBE_SEARCH_YOU_TUBE",
    kind: "read",
    targetFields: ["query"],
  },
};

const APP_ALIASES: Record<string, string[]> = {
  google_calendar: ["googlecalendar", "google calendar", "calendar"],
  google_sheets: ["googlesheets", "google sheets", "sheets"],
  googlesheets: ["google sheets", "sheets"],
  googlecalendar: ["google calendar", "calendar"],
  hubspot: ["hubspot"],
  gmail: ["gmail", "googlemail"],
  notion: ["notion"],
  slack: ["slack"],
  linkedin: ["linkedin"],
  twitter: ["twitter", "x"],
  x: ["twitter", "x"],
  youtube: ["youtube"],
  instagram: ["instagram", "ig"],
};

function ctxEnv(ctx): Record<string, string | undefined> {
  return (ctx?.env ?? process.env) as Record<string, string | undefined>;
}

function str(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown): string {
  return str(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function envNameForApp(app: string): string {
  return `WEBAGENT_COMPOSIO_AUTH_CONFIG_${app.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function toolkitMatchesApp(toolkit: unknown, app: string) {
  const normalizedApp = normalizeKey(app);
  if (!normalizedApp) return false;
  const toolkitSlug = normalizeKey(jsonObject(toolkit).slug || toolkit);
  if (!toolkitSlug) return false;
  if (toolkitSlug === normalizedApp) return true;
  const aliases = APP_ALIASES[normalizedApp] || [];
  return aliases.some((alias) => normalizeKey(alias) === toolkitSlug);
}

function composioConfig(ctx) {
  const env = ctxEnv(ctx);
  const apiKey = str(env.WEBAGENT_COMPOSIO_API_KEY);
  return {
    apiKey,
    baseUrl:
      str(env.WEBAGENT_COMPOSIO_V3_BASE_URL) ||
      str(env.WEBAGENT_COMPOSIO_API_BASE_URL) ||
      DEFAULT_V3_BASE_URL,
  };
}

function requireApiKey(ctx): ReturnType<typeof composioConfig> {
  const cfg = composioConfig(ctx);
  if (!cfg.apiKey) {
    throw new Error("Composio API key is required. Add `composio_api_key` in Settings or set WEBAGENT_COMPOSIO_API_KEY.");
  }
  return cfg;
}

function allowedActions() {
  return Object.entries(MARKETING_ACTIONS).map(([action, meta]) => ({
    action,
    app: meta.app,
    kind: meta.kind,
    composio_action_id: meta.actionId,
  }));
}

function targetFrom(meta: MarketingAction, input: Record<string, unknown>) {
  const parts = [];
  for (const field of meta.targetFields) {
    const value = str(input[field]);
    if (value) parts.push(`${field}=${value.slice(0, 120)}`);
  }
  return parts.join("; ") || meta.app;
}

function isApprovalRequiredForAction(action: string, meta: MarketingAction) {
  if (!action) return false;
  if (action.includes("delete")) return true;
  return meta.kind === "send" || meta.kind === "publish";
}

async function readJsonOrText(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isNodeboxRuntime() {
  return String(process.env.WEBAGENT_RUNTIME ?? "").trim() === "nodebox";
}

function stringifyErrorField(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function formatComposioError(status: number, body: unknown, contentType = ""): string {
  const rec = jsonObject(body);
  const requestId = str(rec.requestId || rec.request_id);
  const message = stringifyErrorField(rec.error || rec.message || rec.detail);
  const detail =
    message ||
    (typeof body === "string" ? body : "") ||
    stringifyErrorField(body) ||
    "(empty response)";
  const reqSuffix = requestId ? ` (requestId=${requestId})` : "";
  const ctSuffix = contentType ? ` [${contentType}]` : "";
  return `Composio request failed (${status}): ${detail.slice(0, 300)}${reqSuffix}${ctSuffix}`;
}

async function composioFetch(ctx, baseUrl: string, path: string, init: RequestInit = {}) {
  const cfg = requireApiKey(ctx);
  const url = `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": cfg.apiKey,
    ...(init.headers || {}),
  };
  if (isNodeboxRuntime()) {
    const payload = await ipcProxyRequest({
      method: String(init.method || "GET").toUpperCase(),
      url,
      headers,
      body: typeof init.body === "string" ? init.body : init.body ? String(init.body) : null,
    });
    if (payload?.error) {
      throw new Error(String(payload.error));
    }
    const status = Number(payload?.status ?? 0);
    const bodyText = String(payload?.body ?? "");
    const contentType = String(payload?.contentType ?? "");
    if (!Number.isFinite(status) || status <= 0) {
      throw new Error(
        `Composio request failed (proxy): unexpected response ${JSON.stringify(payload).slice(0, 240)}`
      );
    }
    let parsed: unknown = bodyText;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      /* keep text */
    }
    if (status < 200 || status >= 300) {
      throw new Error(formatComposioError(status, parsed, contentType));
    }
    if (!bodyText.trim()) return null;
    return parsed;
  }

  const { signal, cleanup } = createTimeoutController(ctx || {});
  try {
    const res = await fetch(url, { ...init, signal, headers });
    const body = await readJsonOrText(res);
    if (!res.ok) {
      throw new Error(formatComposioError(res.status, body));
    }
    return body;
  } finally {
    cleanup();
  }
}

function accountsFromResponse(body: unknown): unknown[] {
  const rec = jsonObject(body);
  const data = rec.data;
  if (Array.isArray(data)) return data;
  const dataRec = jsonObject(data);
  for (const value of [rec.items, rec.connected_accounts, rec.connectedAccounts, dataRec.items, dataRec.connected_accounts, dataRec.connectedAccounts]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function authConfigsFromResponse(body: unknown): unknown[] {
  const rec = jsonObject(body);
  const data = rec.data;
  if (Array.isArray(data)) return data;
  const dataRec = jsonObject(data);
  for (const value of [rec.items, rec.auth_configs, rec.authConfigs, dataRec.items, dataRec.auth_configs, dataRec.authConfigs]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function accountApp(account: unknown): string {
  const rec = jsonObject(account);
  const toolkit = jsonObject(rec.toolkit);
  return str(rec.appName || rec.app_name || rec.toolkitSlug || toolkit.slug || toolkit.name).toLowerCase();
}

function summarizeAccount(account: unknown) {
  const rec = jsonObject(account);
  return {
    id: str(rec.id || rec.connectedAccountId || rec.connected_account_id),
    uuid: str(rec.uuid || jsonObject(rec.connection).uuid || rec.account_id),
    app: accountApp(account),
    status: str(rec.status || jsonObject(rec.state).status),
    name: str(rec.name || rec.displayName || rec.display_name) || undefined,
    user_id: str(rec.user_id || rec.userId || rec.entityId || rec.entity_id || jsonObject(rec.user).id),
    auth_config_id: str(rec.auth_config_id || rec.authConfigId || jsonObject(rec.auth_config).id),
  };
}

function summarizeAuthConfig(config: unknown) {
  const rec = jsonObject(config);
  return {
    id: str(rec.id || rec.auth_config_id || rec.authConfigId),
    toolkit: str(jsonObject(rec.toolkit).slug || rec.toolkit || rec.toolkit_slug),
    name: str(rec.name || rec.display_name || rec.displayName) || undefined,
    is_composio_managed: Boolean(rec.isComposioManaged || rec.is_composio_managed),
  };
}

async function listAuthConfigs(ctx, app: string) {
  const cfg = requireApiKey(ctx);
  const body = await composioFetch(ctx, cfg.baseUrl, "auth_configs", { method: "GET" });
  const configs = authConfigsFromResponse(body).map(summarizeAuthConfig);
  return app ? configs.filter((config) => toolkitMatchesApp(config.toolkit, app)) : configs;
}

async function listToolkitSlugs(ctx, app: string): Promise<string[]> {
  const cfg = requireApiKey(ctx);
  try {
    const body = await composioFetch(
      ctx,
      cfg.baseUrl,
      `tools?toolkit_slug=${encodeURIComponent(app)}&limit=200`,
      { method: "GET" }
    );
    const rec = jsonObject(body);
    const dataArr = Array.isArray(rec.items)
      ? rec.items
      : Array.isArray(rec.data)
        ? rec.data
        : Array.isArray(jsonObject(rec.data).items)
          ? (jsonObject(rec.data).items as unknown[])
          : [];
    return dataArr
      .map((t) => str((t as Record<string, unknown>).slug || (t as Record<string, unknown>).name))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function listConnectedAccounts(ctx, app: string, userId = "") {
  const cfg = requireApiKey(ctx);
  const params = new URLSearchParams();
  if (userId) params.set("user_ids", userId);
  params.set("statuses", "ACTIVE");
  const path = `connected_accounts${params.toString() ? `?${params.toString()}` : ""}`;
  const body = await composioFetch(ctx, cfg.baseUrl, path, { method: "GET" });
  const accounts = accountsFromResponse(body).map(summarizeAccount);
  return app ? accounts.filter((account) => toolkitMatchesApp(account.app, app)) : accounts;
}

function resolveConnectedAccountFromList(
  accounts: Array<Record<string, unknown>>,
  connectedAccountId: string
): Record<string, unknown> | null {
  if (!connectedAccountId) return null;
  const match = accounts.find((account) => {
    const id = str(account.id);
    const uuid = str(account.uuid);
    const name = str(account.name);
    return connectedAccountId === id || connectedAccountId === uuid || connectedAccountId === name;
  });
  return match || null;
}

async function appendExternalActionLog(entry: Record<string, unknown>) {
  try {
    const path = workspaceStatePath(ACTION_LOG_REL);
    await fs.mkdir(nodePath.dirname(path), { recursive: true });
    await fs.appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* best-effort audit log; tool result still reports the action */
  }
  await logDebugEvent("external_action", entry).catch(() => {});
}

export async function composioStatusTool(args: ToolArgs = {}, ctx) {
  const cfg = composioConfig(ctx);
  const app = str(args.app).toLowerCase();
  if (!cfg.apiKey) {
    return {
      ok: true,
      configured: false,
      missing: "WEBAGENT_COMPOSIO_API_KEY",
      allowed_actions: allowedActions(),
    };
  }

  const userId = str(args.user_id || args.userId);
  const [authConfigs, accounts] = await Promise.all([
    listAuthConfigs(ctx, app),
    listConnectedAccounts(ctx, app, userId),
  ]);
  return {
    ok: true,
    configured: true,
    app: app || undefined,
    connected_accounts: accounts,
    auth_configs: authConfigs,
    missing_apps: app && accounts.length === 0 ? [app] : [],
    allowed_actions: allowedActions(),
  };
}

export async function composioConnectTool(args: ToolArgs = {}, ctx) {
  const app = str(args.app).toLowerCase();
  if (!app) throw new Error("`app` is required for composio_connect.");
  const env = ctxEnv(ctx);
  const authConfigId = str(args.auth_config_id || args.authConfigId || env[envNameForApp(app)]);
  const userId = str(args.user_id || args.userId || ctx?.profile?.userName || ctx?.profile?.name || "default");

  if (!authConfigId) {
    const [authConfigs, connectedAccounts] = await Promise.all([
      listAuthConfigs(ctx, app),
      listConnectedAccounts(ctx, app, userId),
    ]);
    const activeAccounts = connectedAccounts.filter((account) => account.status === "ACTIVE");
    const existing = activeAccounts[0] || connectedAccounts[0] || null;
    if (existing && connectedAccounts.length === 1) {
      return {
        ok: true,
        app,
        user_id: userId,
        ready: true,
        selected_connected_account: existing,
        connected_accounts: connectedAccounts,
        auth_configs: authConfigs,
        message: `Reusing the existing ${app} connection.`,
      };
    }
    if (authConfigs.length === 1 && connectedAccounts.length === 0) {
      return await composioConnectTool({ ...args, auth_config_id: authConfigs[0].id, user_id: userId }, ctx);
    }
    return {
      ok: true,
      app,
      user_id: userId,
      needs_choice: true,
      connected_accounts: connectedAccounts,
      auth_configs: authConfigs,
      message:
        connectedAccounts.length > 1
          ? `Multiple ${app} accounts are connected. Choose one by connected_account_id.`
          : authConfigs.length > 1
            ? `Multiple ${app} auth configs exist. Choose one by auth_config_id.`
            : `No ${app} auth config is selected yet. Pick an auth_config_id or connected account.`,
    };
  }

  const cfg = requireApiKey(ctx);
  const body = await composioFetch(ctx, cfg.baseUrl, "connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      auth_config_id: authConfigId,
      ...(str(args.callback_url || args.callbackUrl) ? { callback_url: str(args.callback_url || args.callbackUrl) } : {}),
    }),
  });
  const rec = jsonObject(body);
  const data = jsonObject(rec.data);
  const redirectUrl = str(rec.redirect_url || rec.redirectUrl || data.redirect_url || data.redirectUrl);
  await appendExternalActionLog({
    timestamp: new Date().toISOString(),
    app,
    action: "composio_connect",
    target: userId,
    success: Boolean(redirectUrl),
  });
  return {
    ok: true,
    app,
    user_id: userId,
    redirect_url: redirectUrl,
    connection_request: body,
  };
}

export async function composioActionTool(args: ToolArgs = {}, ctx) {
  const cfg = requireApiKey(ctx);
  const action = str(args.action);
  const meta = MARKETING_ACTIONS[action];
  if (!meta) {
    throw new Error(`Unsupported Composio marketing action \`${action || "(empty)"}\`. Use one of: ${Object.keys(MARKETING_ACTIONS).join(", ")}.`);
  }
  const input = jsonObject(args.args || args.input || args.arguments);
  const requestedConnectedAccountId = str(args.connected_account_id || args.connectedAccountId);
  const requestedUserId = str(args.user_id || args.userId);

  // Always fetch the live account list. Composio v3 scopes connected_account_id to a
  // specific user_id; if we send the wrong user_id it 400s. The status check uses the
  // same listing, so the resolved account here always matches what status reports.
  const accounts = (await listConnectedAccounts(ctx, meta.app, "")) as Array<ReturnType<typeof summarizeAccount>>;
  const activeAccounts = accounts.filter((a) => !a.status || a.status === "ACTIVE");
  const pool = activeAccounts.length ? activeAccounts : accounts;
  const matched = requestedConnectedAccountId
    ? (resolveConnectedAccountFromList(pool, requestedConnectedAccountId) as ReturnType<typeof summarizeAccount> | null)
    : null;
  const selected = matched || (pool.length >= 1 ? pool[0] : null);

  if (!selected) {
    throw new Error(
      `No connected ${meta.app} account found. Run composio_connect for "${meta.app}" first.`
    );
  }
  if (requestedConnectedAccountId && !matched) {
    throw new Error(
      `connected_account_id "${requestedConnectedAccountId}" not found among active ${meta.app} accounts. ` +
        `Available: ${pool.map((a) => a.id).filter(Boolean).join(", ") || "(none)"}.`
    );
  }

  const resolvedConnectedAccountId = str(selected.id || selected.uuid);
  const userId =
    requestedUserId ||
    str(selected.user_id) ||
    str(ctx?.profile?.userName || ctx?.profile?.name);
  if (!resolvedConnectedAccountId) {
    throw new Error(`Resolved ${meta.app} account is missing a connected_account_id (got ${JSON.stringify(selected)}).`);
  }
  if (!userId) {
    throw new Error(`Resolved ${meta.app} account is missing a user_id. Pass user_id explicitly.`);
  }
  const approvalRequired = isApprovalRequiredForAction(action, meta);
  if (approvalRequired) {
    const ok = await gateToolExecution({
      ctx,
      toolLabel: "composio_action",
      summary: summarizeToolApproval("composio_action", { action, args: input }),
      args: { action, args: input },
      risky: true,
      toolEmoji: "🧩",
    });
    if (!ok) throw new Error("user_denied");
  }
  const requestBody = {
    arguments: input,
    connected_account_id: resolvedConnectedAccountId,
    user_id: userId,
  };
  let body: unknown;
  try {
    body = await composioFetch(ctx, cfg.baseUrl, `tools/execute/${encodeURIComponent(meta.actionId)}`, {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    if (/failed \(404\)/.test(String(err))) {
      const slugs = await listToolkitSlugs(ctx, meta.app);
      const matches = slugs.filter((s) => {
        const u = s.toUpperCase();
        return (
          u.includes(meta.actionId.toUpperCase()) ||
          meta.actionId.toUpperCase().includes(u) ||
          action.split("_").every((tok) => u.includes(tok.toUpperCase()))
        );
      });
      const hint = matches.length
        ? ` Closest catalog slugs: ${matches.slice(0, 10).join(", ")}.`
        : slugs.length
          ? ` Sample ${meta.app} slugs: ${slugs.slice(0, 15).join(", ")}.`
          : "";
      throw new Error(
        `Composio action "${meta.actionId}" not found in v3 catalog for toolkit "${meta.app}".${hint} ` +
          `Update MARKETING_ACTIONS["${action}"].actionId in src/agent/runtime/tools/composio-tools.ts.`
      );
    }
    throw err;
  }
  const rec = jsonObject(body);
  const success =
    rec.successful === true ||
    rec.successful === "true" ||
    rec.success === true ||
    rec.successfull === true ||
    rec.successfull === "true" ||
    !rec.error;
  await appendExternalActionLog({
    timestamp: new Date().toISOString(),
    app: meta.app,
    action,
    composio_action_id: meta.actionId,
    kind: meta.kind,
    target: targetFrom(meta, input),
    success,
    result_summary: rec.error ? String(rec.error).slice(0, 240) : "ok",
  });
  return {
    ok: success,
    action,
    app: meta.app,
    kind: meta.kind,
    approval_required: approvalRequired,
    composio_action_id: meta.actionId,
    connected_account_id: resolvedConnectedAccountId,
    user_id: userId,
    result: body,
  };
}
