# Manual testing checklist — Web Agent

## Profiles

- [ ] Fresh load creates a named profile from the built-in name pool.
- [ ] Create second profile with custom personality and accent color.
- [ ] Switch active profile while agent is **stopped**; selection persists after reload.
- [ ] Cannot delete the last profile.

## Launch / terminal

- [ ] **Launch Web Agent** reaches the pink `❯` prompt in under ~5s (first WebContainer boot may be slower).
- [ ] With no API keys, agent prints a clear error and exits without crashing the UI.
- [ ] With a valid key, send a short message; streaming reply appears.
- [ ] **Stop** terminates the process; status bar returns to Stopped.
- [ ] Resize terminal; layout remains usable (PTY resize does not freeze the tab).

## Tools (smoke)

From the running agent, ask it to:

- [ ] `read_file` / `write_file` under `/workspace`
- [ ] `list_dir` or `tree`
- [ ] `grep` or `find_files`
- [ ] `run_shell` (e.g. `echo test`)
- [ ] `web_fetch` on a public `https://` URL

## Persistence

- [ ] Create a file in `/workspace`, **Stop**, reload page, **Launch** — file still present for that profile.
- [ ] **Export workspace** (Workspaces tab) downloads JSON.
- [ ] **Import** the same JSON back into another profile (optional).

## Settings

- [ ] **Custom** provider: base URL + API key; agent resolves `CUSTOM_BASE_URL` / `CUSTOM_API_KEY`.
