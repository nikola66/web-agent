# Contributing

Thanks for contributing to Web Agent.

## Principles

- Keep changes surgical.
- Do not add complexity unless it is necessary.
- Clean up stale code caused by your change.
- Preserve the browser-native, local-first, isolated design of the project.
- Do not commit per-profile workspace mirrors (`memory/`, `tmp/`, `knowledge-vault/`, `.webagent/`, SQLite DBs, etc.): they belong in browser storage and are listed in `.gitignore`.

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
npm run test
npm run test:browser
```

## Before Opening A Pull Request

- verify the change solves a real problem
- keep the diff focused
- update docs when behavior changes; if user-facing copy changed, update English and any affected locale files (see [docs/TRANSLATING.md](docs/TRANSLATING.md))
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

- [README.md](README.md) — [简体中文](README.zh-CN.md) · [Español](README.es.md) · [العربية](README.ar.md)
- [docs/README.md](docs/README.md) — docs hub and locale folders
- [CAPABILITIES.md](CAPABILITIES.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/agent-notes.md](docs/agent-notes.md)
- [docs/testing-checklist.md](docs/testing-checklist.md)
- [docs/GLOSSARY.md](docs/GLOSSARY.md) · [docs/TRANSLATING.md](docs/TRANSLATING.md)
