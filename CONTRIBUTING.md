# Contributing

Thanks for contributing to Web Agent.

## Desktop (Tauri)

The desktop shell lives under `src-tauri/`. It starts a loopback HTTP server (random port on `127.0.0.1`), serves the Vite `dist/` bundle, mirrors the dev-server proxies from `vite.config.ts`, and opens the main window at that origin so `window.location.origin` matches the static host.

```bash
npm run build          # produce dist/ (also run by tauri before dev/build)
npm run tauri:dev      # desktop dev (rebuild frontend first via beforeDevCommand)
npm run tauri:build    # release bundles
```

Equivalent from the Rust directory: `cd src-tauri && cargo tauri dev` / `cargo tauri build` (requires the [Tauri CLI](https://v2.tauri.app/start/prerequisites/) on `PATH` or use `npm run tauri -- …`).

**macOS release hygiene:** Apple code signing and notarization are not configured in this repository. For distribution outside your own machine, plan on an Apple Developer Program signing identity, `codesign` for the app bundle, `notarytool` submission, and stapling; see Apple’s “Notarize macOS software” documentation.

## Principles

- Keep changes surgical.
- Do not add complexity unless it is necessary.
- Clean up stale code caused by your change.
- Preserve the browser-native, local-first, isolated design of the project.

## Development Setup

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
npm install
npm run dev
```

Open `http://localhost:5173`.

## Useful Commands

```bash
npm run dev
npm run build
npm run tauri:dev
npm run tauri:build
npm run test
npm run test:browser
```

## Before Opening A Pull Request

- verify the change solves a real problem
- keep the diff focused
- update docs when behavior changes
- add or update tests when the change affects runtime behavior
- avoid unrelated refactors

If you touch browser-local persistence, runtime isolation, uploads, tools, or profile state, explain the impact clearly in the PR description.

## Reporting Bugs

Open a GitHub issue with:

- what you expected
- what happened instead
- exact reproduction steps
- browser and OS details
- whether the problem happens in the hosted demo, local development, or both

For security-sensitive reports, use [SECURITY.md](SECURITY.md) instead of public issues.

## Pull Request Style

- prefer the smallest correct fix
- match the existing code style
- remove dead imports, stale branches, and local residue caused by your change
- keep user-facing copy concise and concrete

## Contributor Docs

- [README.md](README.md)
- [CAPABILITIES.md](CAPABILITIES.md)
- [docs/agent-notes.md](docs/agent-notes.md)
- [docs/testing-checklist.md](docs/testing-checklist.md)
