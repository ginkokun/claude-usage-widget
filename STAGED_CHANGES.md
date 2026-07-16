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

---

## Changes

- macOS tray gains a **RELAY STATION // AGENT CONTROL** submenu: launch Codex/Claude coordinator prompts, open the Terminal Control Board (`agent_watch.py`), and open the TV Fleet Dashboard. See [RELAY_AGENT_CONTROL.md](RELAY_AGENT_CONTROL.md).

*Add new entries above this line as additional branches are staged.*
