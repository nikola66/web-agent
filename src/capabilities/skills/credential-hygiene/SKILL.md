---
name: Credential Hygiene
description: Use when the user pastes API keys, asks to commit .env, store secrets, or redact tokens from logs and artifacts.
version: 1.0.0
category: bundled
tags: [security, credentials, api-keys, privacy, secrets, env, redact]
triggers: [api key, secret, .env, paste key, sk-, bearer, rotate key, commit secrets, redact, password in chat]
---

## When to Use

- User pastes keys in chat or asks to commit `.env` / track secrets in git.
- Configuring OpenRouter, browser agent, email, or Telegram credentials.
- Writing docs or artifacts that might echo secrets; sharing logs or screenshots.
- User asks where to put keys—direct to Settings/vault, not memory or workspace prose.

## Rules

1. **Settings / vault**: Store provider keys in the app **per profile** (encrypted local vault), not in workspace files the model edits casually.
2. **Never echo secrets** in assistant-visible replies, `artifact_present` bodies, or pasted logs — redact (`sk-…`, long hex tokens, bearer strings).
3. **Workspace files**: Avoid writing long-lived secrets into tracked paths. If the user insists on a local config file, use least privilege and warn about git; never add keys to public repos on their behalf.
4. **`read_file` on secrets**: Only when the user explicitly asked to inspect a local config path they own — do not exfiltrate to unrelated surfaces.

## Product facts (Web Agent)

- Profiles can hold separate API keys; README describes **per-profile** keys and optional email delivery credentials.
- Persistence is **browser-local** — export/import is portability, not a reason to plaintext secrets in chat.

## Pitfalls

- Putting TinyFish / OpenRouter keys in `memory_save` as prose — use vault/settings; memory is for preferences and stable non-secret facts.
- Screenshot or transcript sharing — strip keys first.

## Anti-patterns

- "Paste your API key here so I can test" — direct to Settings.
- Duplicating the same secret in skills, memory, and files — one vault source of truth.
