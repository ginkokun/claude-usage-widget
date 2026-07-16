# Staged Changes

Changes accumulating here have already been merged into `develop`.
We keep track of these changes/fixes/features and when we have enough for a new release we decide on the next version number.

This file is tracked in the repo and visible to everyone.

---

## Branches Staged

| Branch | Description |
|--------|-------------|
| `fix/ci-actions-node20` | Bump actions/checkout and actions/setup-node to v5; Node.js matrix 18→20 |
| `codex/macos-agent-control` | Add macOS tray submenu for Relay Station agent control (Codex/Claude coordinator launch, Terminal Control Board, TV Fleet Dashboard) |
| `codex/fleet-f2` | Add the widget's fleet transport (F-2): an independent poll of the F-1 safe-snapshot outbox and a best-effort push to the fleet aggregator, separate from the RSM-4 usage push |

---

## Changes

- macOS tray gains a **RELAY STATION // AGENT CONTROL** submenu: launch Codex/Claude coordinator prompts, open the Terminal Control Board (`agent_watch.py`), and open the TV Fleet Dashboard. See [RELAY_AGENT_CONTROL.md](RELAY_AGENT_CONTROL.md).
- **2026-07-16 — Fleet transport (F-2).** New pure module `src/push-fleet-snapshot.js` polls `agent_watch.py`'s F-1 safe-snapshot outbox (~5s) and pushes it to the fleet aggregator, plus a ~30s full-snapshot heartbeat, with material-change suppression via a content hash. Wholly separate from, and never touching, the RSM-4 usage push: its own `settings.fleetUrl`, its own `fleet_ingest` credential (new `set-fleet-token`/`has-fleet-token` IPC, **fail-closed** via `safeStorage` — no plaintext fallback), its own timer, its own `emitter_epoch`/`seq` transport identity minted fresh per widget restart. See [RELAY_AGENT_CONTROL.md](RELAY_AGENT_CONTROL.md#fleet-transport-f-2). **Known gaps:** the offline test suite was verified green on macOS only in this session — the Windows leg still needs to be run on the operator's Windows machine; and this change takes effect only after an operator rebuild/release (`RELEASE_PROCESS.md`), not an autonomous deploy.

*Add new entries above this line as additional branches are staged.*
