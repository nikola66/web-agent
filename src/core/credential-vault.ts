/**
 * Encrypted API key storage using Web Crypto API.
 *
 * Keys are encrypted with AES-GCM using a key derived from the browser's
 * origin + a random salt (stored in IndexedDB). API keys never leave
 * the browser and are never written to the agent filesystem.
 */

import { get, set, del } from "idb-keyval";

const SALT_KEY = "credential_vault_salt";
const KEYS_KEY = "credential_vault_keys";

async function getOrCreateSalt(): Promise<Uint8Array> {
  let salt = await get<Uint8Array>(SALT_KEY);
  if (!salt) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    await set(SALT_KEY, salt);
  }
  return salt;
}

async function deriveKey(): Promise<CryptoKey> {
  const salt = await getOrCreateSalt();
  // Derive a key from the origin (not user-facing — just prevents trivial
  // cross-origin reads; keys are still readable by any script on this origin)
  const baseKeyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(window.location.origin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: "SHA-256" },
    baseKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  // Pack iv + ciphertext into a base64 string
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(key: CryptoKey, encoded: string): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ── Public API ───────────────────────────────────────────────────────

/** Save all API keys (encrypted) to IndexedDB */
export async function saveApiKeys(keys: Record<string, string>): Promise<void> {
  const cryptoKey = await deriveKey();
  const encrypted: Record<string, string> = {};
  for (const [provider, apiKey] of Object.entries(keys)) {
    if (apiKey) {
      encrypted[provider] = await encrypt(cryptoKey, apiKey);
    }
  }
  await set(KEYS_KEY, encrypted);
}

/** Load and decrypt API keys from IndexedDB */
export async function loadApiKeys(): Promise<Record<string, string>> {
  const encrypted = await get<Record<string, string>>(KEYS_KEY);
  if (!encrypted) return {};

  const cryptoKey = await deriveKey();
  const decrypted: Record<string, string> = {};
  for (const [provider, ciphertext] of Object.entries(encrypted)) {
    try {
      decrypted[provider] = await decrypt(cryptoKey, ciphertext);
    } catch {
      // Key corrupted — skip
    }
  }
  return decrypted;
}

/** Per-profile credentials storage key */
const PROFILE_CREDENTIALS_KEY = "credential_vault_profile_keys";

export type ProfileCredentials = {
  apiKey?: string;
  customBaseUrl?: string;
  channelTokens?: Record<string, string>;
  // Legacy field for migration from old vault format
  telegramBotToken?: string;
};

/** Save per-profile credentials (encrypted) to IndexedDB */
export async function saveProfileCredentials(
  profileId: string,
  creds: ProfileCredentials
): Promise<void> {
  const cryptoKey = await deriveKey();
  const all =
    (await get<Record<string, Record<string, string>>>(PROFILE_CREDENTIALS_KEY)) ?? {};

  const encrypted: Record<string, string> = {};
  if (creds.apiKey) {
    encrypted.apiKey = await encrypt(cryptoKey, creds.apiKey);
  }
  if (creds.customBaseUrl) {
    encrypted.customBaseUrl = await encrypt(cryptoKey, creds.customBaseUrl);
  }
  if (creds.channelTokens && Object.keys(creds.channelTokens).length > 0) {
    encrypted.channelTokens = await encrypt(cryptoKey, JSON.stringify(creds.channelTokens));
  }

  all[profileId] = encrypted;
  await set(PROFILE_CREDENTIALS_KEY, all);
}

/** Load and decrypt per-profile credentials from IndexedDB */
export async function loadProfileCredentials(profileId: string): Promise<ProfileCredentials> {
  const all = await get<Record<string, Record<string, string>>>(PROFILE_CREDENTIALS_KEY);
  if (!all || !all[profileId]) return {};

  const cryptoKey = await deriveKey();
  const encrypted = all[profileId]!;
  const decrypted: ProfileCredentials = {};

  if (encrypted.apiKey) {
    try {
      decrypted.apiKey = await decrypt(cryptoKey, encrypted.apiKey);
    } catch {
      /* Key corrupted — skip */
    }
  }
  if (encrypted.customBaseUrl) {
    try {
      decrypted.customBaseUrl = await decrypt(cryptoKey, encrypted.customBaseUrl);
    } catch {
      /* Key corrupted — skip */
    }
  }
  if (encrypted.channelTokens) {
    try {
      const tokenStr = await decrypt(cryptoKey, encrypted.channelTokens);
      decrypted.channelTokens = JSON.parse(tokenStr);
    } catch {
      /* Key corrupted — skip */
    }
  }

  // Migration: lift old telegramBotToken into channelTokens["telegram"]
  if (encrypted.telegramBotToken && !decrypted.channelTokens?.telegram) {
    try {
      const token = await decrypt(cryptoKey, encrypted.telegramBotToken);
      if (!decrypted.channelTokens) {
        decrypted.channelTokens = {};
      }
      decrypted.channelTokens.telegram = token;
    } catch {
      /* Key corrupted — skip */
    }
  }

  return decrypted;
}

/** Clear credentials for a specific profile */
export async function clearProfileCredentials(profileId: string): Promise<void> {
  const all = await get<Record<string, Record<string, string>>>(
    PROFILE_CREDENTIALS_KEY
  );
  if (!all) return;

  delete all[profileId];
  if (Object.keys(all).length === 0) {
    await del(PROFILE_CREDENTIALS_KEY);
  } else {
    await set(PROFILE_CREDENTIALS_KEY, all);
  }
}

/** Delete all stored credentials */
export async function clearCredentials(): Promise<void> {
  await del(KEYS_KEY);
  await del(PROFILE_CREDENTIALS_KEY);
  await del(SALT_KEY);
}
