# LinuxOnTab runtime spike (`experiment/linuxontab-runtime`)

Experimental branch that adds a feature-flagged LinuxOnTab / v86 backend alongside the existing Nodebox runtime.

## Enable

In `.env.local`:

```env
VITE_WEBAGENT_RUNTIME=linuxontab
```

Or append `?runtime=linuxontab` to the app URL for a one-off trial.

Optional tuning:

```env
VITE_LINUXONTAB_ASSET_BASE=https://linuxontab.com/shell/
VITE_LINUXONTAB_ISO=alpine.iso
VITE_LINUXONTAB_MEM_MB=2048
VITE_LINUXONTAB_RELAY_URL=wisps://linuxontab-net.fly.dev/wisp
```

## Acceptance checks (manual)

1. Launch a profile with the flag enabled — Alpine boots via v86 (first boot can take several minutes).
2. Adapter logs show Node + Python probes after `apk add nodejs npm python3`.
3. Agent completes at least one turn using existing stdout IPC markers.
4. With the flag off, Nodebox path behaves as before.

## Architecture

- Runtime port: [`src/runtimes/types.ts`](../src/runtimes/types.ts)
- Selector: [`src/runtimes/config.ts`](../src/runtimes/config.ts)
- Nodebox adapter: [`src/runtimes/nodebox/index.ts`](../src/runtimes/nodebox/index.ts)
- LinuxOnTab adapter: [`src/runtimes/linuxontab/boot.ts`](../src/runtimes/linuxontab/boot.ts)
- Agent wiring: [`src/agent/adapter.ts`](../src/agent/adapter.ts)

## Known risks / next steps

| Area | Risk | Next step |
|------|------|-----------|
| Boot time | v86 + Alpine ISO is heavy vs Nodebox CDN | Pre-baked snapshot restore; self-host assets |
| Agent IPC | FIFO + serial polling is a spike, not production PTY | Dedicated tmux window or virtio channel |
| Persistence | OPFS snapshot sync uses shell/base64 FS shim | Wire v86 fs9p for bulk sync |
| Networking | WISP relay dependency for `apk add` / LLM proxy | Direct guest egress + drop IPC proxy where safe |
| Node 22+ | Alpine repo may ship older Node | Pin NodeSource or custom ISO layer with Node 22+ |

## Go / no-go (initial)

**Go for continued integration** if manual checks pass and boot latency is acceptable for your use case. **No-go for default flip** until agent IPC, persistence, and Node 22+ are validated on target hardware.

Reference: [LinuxOnTab](https://github.com/kilian-ai/linuxontab) · [linuxontab.com/shell/](https://linuxontab.com/shell/)
