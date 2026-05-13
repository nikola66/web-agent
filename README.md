![Web Agent](public/images/preview.webp)

<div align="center">

# Web Agent

**Browser-native AI agent with isolated workspaces, persistent memory, and zero setup friction.**

[Live demo](https://webagent.aratech.ae) · [GitHub](https://github.com/nikola66/web-agent) · [Support on Ko-fi](http://ko-fi.com/nikola66) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

Web Agent is an open-source AI agent that runs directly in the browser on top of WebContainers. There is nothing to install to use it: no Docker, no VPS, no VM, no Mac mini, no Hostinger box, no local Python stack. Open the app, launch a profile, and start working.

It is designed to feel simple for end users and capable for power users: isolated profiles, browser-local persistence, tools, skills, sessions, reflections, learnings, cron jobs, and a self-improving runtime that stays on the user’s machine.

## Why Web Agent

- **Click and run**. Launch from the browser with no install step for end users.
- **Isolated by default**. Every profile gets its own workspace, memory, and runtime state.
- **Self-learning**. Skills, reflections, learnings, facts, and session memory help the agent improve over time.
- **Local-first persistence**. Workspaces, memory, sessions, and skills live in browser storage and can be exported or re-imported later.
- **Hosted without server-side user state**. The hosted demo serves the app, while user files and agent state stay in the browser.
- **Open source**. Free to use, fork, modify, and distribute under the MIT License.

## Highlights

- Browser-native Node.js runtime powered by WebContainers
- Isolated profiles with separate workspaces and memories
- Built-in tools for files, shell, search, fetch, memory, sessions, cron, and skills
- Persistent fact store, rolling session memory, reflections, and learnings
- Uploads into the live workspace with image handoff to vision tools
- Encrypted API keys stored locally in the browser
- Export and import flows for long-lived browser-local workspaces
- Hosted demo for zero-friction trial usage

## How Persistence Works

Web Agent keeps user state in browser storage on the user’s machine. That includes workspaces, sessions, memory, facts, learnings, skills, todos, cron metadata, and local credentials. Nothing in that persistent agent state is meant to live on the server.

As long as the browser keeps its local storage and OPFS data, the agent keeps its history and workspace. When you want portability, export the workspace or browser-local state and import it later on the same machine or another one.

For hosted deployments, the safest framing is:

- **The app can be hosted anywhere**
- **The agent state lives in the browser**
- **The server should only deliver the app and relay allowed upstream requests when needed**

## Quick Start

### Use the hosted demo

Open [webagent.aratech.ae](https://webagent.aratech.ae), create or select a profile, add your provider key, click **Launch**, and start chatting.

### Run locally

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
npm install
npm run dev
```

Open `http://localhost:5173`.

## Development

```bash
npm run dev
npm run build
npm run test
npm run test:browser
```

Contributor-facing docs:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CAPABILITIES.md](CAPABILITIES.md)
- [docs/agent-notes.md](docs/agent-notes.md)
- [docs/testing-checklist.md](docs/testing-checklist.md)

## Architecture At A Glance

- **Frontend**: React + Vite + xterm.js
- **Runtime**: Node.js inside WebContainers
- **Persistence**: IndexedDB + OPFS in the browser
- **Isolation**: profile-scoped workspaces and runtime state
- **Model access**: OpenRouter or OpenAI-compatible providers

The agent runtime is embedded into the browser app, mounted into a live workspace, and launched inside a terminal-backed Node environment. Profiles keep personalities, settings, workspace state, and memory separated.

## Privacy And Security

- Workspace files, sessions, memory, skills, and local credentials stay browser-side.
- API keys are stored locally and encrypted before persistence.
- Profiles are isolated from each other.
- Hosted mode should remain transit-only for upstream requests, not a persistence backend for user state.

See [SECURITY.md](SECURITY.md) for reporting and security posture details.

## Open Source

Web Agent is an open-source project. You are free to use it, fork it, modify it, and distribute it under the [MIT License](LICENSE).

Inspired by OpenClaw, [Hermes Agent](https://github.com/NousResearch/hermes-agent), and OpenCrabs.

## Support And Sponsorship

If Web Agent saves you time or helps your work, support ongoing development on [Ko-fi](http://ko-fi.com/nikola66). Sponsorship helps fund continued maintenance, new capabilities, UI polish, and long-term improvements.

<table>
  <tr>
    <td align="center"><a href="http://ko-fi.com/nikola66">Support on Ko-fi</a></td>
    <td align="center"><a href="https://github.com/nikola66/web-agent">Star on GitHub</a></td>
  </tr>
</table>

### Sponsor This Project

<table>
  <tr>
    <td align="center"><img src="public/logos/sponsor-placeholder.svg" width="180" alt="Sponsor placeholder" /><br />Sponsor project<br />Place logo here</td>
    <td align="center"><img src="public/logos/sponsor-placeholder.svg" width="180" alt="Sponsor placeholder" /><br />Sponsor project<br />Place logo here</td>
    <td align="center"><img src="public/logos/sponsor-placeholder.svg" width="180" alt="Sponsor placeholder" /><br />Sponsor project<br />Place logo here</td>
  </tr>
</table>

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), keep changes surgical, and prefer fixes that preserve the project’s browser-native and local-first design.

## License

MIT. See [LICENSE](LICENSE).
