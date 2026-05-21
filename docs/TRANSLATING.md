# Translating Web Agent docs

English files at their historical paths are **canonical**. Translations may lag; when behavior changes, update English first, then affected locales.

## Layout

| English (canonical) | Chinese | Spanish | Arabic |
| --- | --- | --- | --- |
| `README.md` | `README.zh-CN.md` | `README.es.md` | `README.ar.md` |
| `CONTRIBUTING.md` | `CONTRIBUTING.zh-CN.md` | … | … |
| `SECURITY.md` | `SECURITY.zh-CN.md` | … | … |
| `docs/*.md` | `docs/zh-CN/*.md` | `docs/es/*.md` | `docs/ar/*.md` |

`CAPABILITIES.md`, `DESIGN.md`, `AGENTS.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` live under `docs/{locale}/` only (not duplicated at repo root except CONTRIBUTING and SECURITY).

## Sync header

At the top of every translated file (HTML comment, invisible on GitHub render):

```markdown
<!-- i18n-sync: en@8293e87 2026-05-20 -->
```

Bump the git short SHA and date when you re-sync that file with English.

## Language bar

Root README translations:

```markdown
**Languages:** [English](README.md) · [简体中文](README.zh-CN.md) · …
```

`docs/{locale}/README.md` links back to [docs/README.md](README.md) and sibling locales.

## Rules

1. Follow [GLOSSARY.md](GLOSSARY.md) for do-not-translate terms.
2. Keep code blocks, CLI commands, env vars, and tool names identical to English.
3. In [test-prompts.md](test-prompts.md), translate instructions only; **keep prompt text in English** (prompts target the agent).
4. In [use-cases-playbook.md](use-cases-playbook.md) and root README playbook indexes, translate section titles, category labels, and use-case descriptions; **keep copy-paste prompts, tool IDs, skill slugs, and paths in English**. Each locale has `docs/{locale}/use-cases-playbook.md`; the root README carries a compact index table linking to the full playbook.
5. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): add *“The English version is authoritative for enforcement.”* at the top of each translation.
6. Arabic: natural RTL prose; leave code, paths, and slash commands in Latin.

## PR checklist

- [ ] English updated if behavior changed
- [ ] Glossary terms unchanged in translations
- [ ] Sync headers bumped for touched locale files
- [ ] Language bars and relative links verified
