# Staged Changes

Changes accumulating here have already been merged into `develop`.
We keep track of these changes/fixes/features and when we have enough for a new release we decide on the next version number.

This file is tracked in the repo and visible to everyone.

---

## Branches Staged

| Branch | Description |
|--------|-------------|
| `codex/fleet-widget-panel` | Add a "Fleet" settings panel — the widget is now the single control surface for a machine's fleet setup (collision key generate/paste, key id, fleet URL, ingest token, read-only machine_id) |
| `fix/ci-actions-node20` | Bump actions/checkout and actions/setup-node to v5; Node.js matrix 18→20 |
| `codex/macos-agent-control` | Add macOS tray submenu for Relay Station agent control (Codex/Claude coordinator launch, Terminal Control Board, TV Fleet Dashboard) |
| `codex/fleet-f2` | Add the widget's fleet transport (F-2): an independent poll of the F-1 safe-snapshot outbox and a best-effort push to the fleet aggregator, separate from the RSM-4 usage push |

---

## Changes

- **2026-07-16 — Fleet settings panel.** New "Fleet" section in the Settings panel makes the widget the single control surface for a machine's fleet setup: a collision key row (**Generate** a fresh 32-byte key shown once, or paste one from another machine), a collision key ID field, the fleet aggregator URL, the fleet ingest token (`set-fleet-token`, unchanged), and a read-only `machine_id` display. New pure module `src/fleet-config.js` (`get-fleet-config`/`set-fleet-config`/`generate-collision-key` IPC) atomically writes `fleet_collision_key` and `collision_key_id` to `fleet_config.json` next to the F-1/F-2 outbox — the same file `agent_watch.py` reads, and where it mints/persists `machine_id`. Writes always preserve an existing `machine_id` and never wipe a stored key on a blank-key save; reads never return the raw key. See [RELAY_AGENT_CONTROL.md](RELAY_AGENT_CONTROL.md#fleet-setup-the-widget-as-the-single-control-surface). No privacy-profile concept — the machine always emits the full field set. **Known gap:** the `relaystation_main` fleet doc (`AGENT_OBSERVABILITY_FLEET.md` §4) still needs an update pointing operators at this panel — separate, later card. Takes effect only after an operator rebuild/release (`RELEASE_PROCESS.md`), not an autonomous deploy.
- macOS tray gains a **RELAY STATION // AGENT CONTROL** submenu: launch Codex/Claude coordinator prompts, open the Terminal Control Board (`agent_watch.py`), and open the TV Fleet Dashboard. See [RELAY_AGENT_CONTROL.md](RELAY_AGENT_CONTROL.md).
- **2026-07-16 — Fleet transport (F-2).** New pure module `src/push-fleet-snapshot.js` polls `agent_watch.py`'s F-1 safe-snapshot outbox (~5s) and pushes it to the fleet aggregator, plus a ~30s full-snapshot heartbeat, with material-change suppression via a content hash. Wholly separate from, and never touching, the RSM-4 usage push: its own `settings.fleetUrl`, its own `fleet_ingest` credential (new `set-fleet-token`/`has-fleet-token` IPC, **fail-closed** via `safeStorage` — no plaintext fallback), its own timer, its own `emitter_epoch`/`seq` transport identity minted fresh per widget restart. See [RELAY_AGENT_CONTROL.md](RELAY_AGENT_CONTROL.md#fleet-transport-f-2). **Known gaps:** the offline test suite was verified green on macOS only in this session — the Windows leg still needs to be run on the operator's Windows machine; and this change takes effect only after an operator rebuild/release (`RELEASE_PROCESS.md`), not an autonomous deploy.

*Add new entries above this line as additional branches are staged.*
