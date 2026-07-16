# Relay Station Agent Control (macOS)

## Purpose

The existing Claude Usage Widget remains the single macOS tray surface for both
Claude usage stats and Relay Station pipeline shortcuts. This feature adds a
submenu to that tray — it does not introduce a second daemon or a second
status item.

## Prerequisite

macOS, with **Show Tray Stats** enabled in Settings. The `RELAY STATION //
AGENT CONTROL` submenu appears identically on both usage tray icons (Session
and Weekly).

## Actions

| Action | Behavior |
|--------|----------|
| Launch Codex Coordinator… | Opens the official `codex://threads/new` deep link with a new task composer prefilled with the coordinator prompt. It never auto-sends — the operator submits it manually. |
| Launch Claude Coordinator… | Copies an Opus/high coordinator prompt to the clipboard and opens Claude Desktop. Claude Desktop has no deep link to prefill a chat, so the operator must create/select a chat and paste/send the prompt themselves. |
| Open Terminal Control Board | Launches a Terminal window running the absolute path to `<relaystationMain repo>/scripts/agent_watch.py` as the watch board. |
| Open TV Fleet Dashboard | Opens only a valid, configured HTTP(S) URL. Disabled (greyed out) while no dashboard URL is configured. |

## Work description prompt

Launching the Codex or Claude coordinator first asks a native macOS question,
"What are we working on?", capped at 2000 characters. Cancelling the dialog or
leaving it blank quietly aborts the launch (no error). Any other failure
(missing repo, launch error, over-length input) surfaces as a visible
notification.

## Configuration

Two non-secret `electron-store` keys drive this feature:

- `settings.relayStationRepoPath` — absolute path to the Relay Station repo
  used for the Terminal Control Board and Codex prompt context. Defaults to a
  path derived from the current user's home directory when unset.
- `settings.relayStationDashboardUrl` — the TV Fleet Dashboard URL. This
  remains operator-managed (set manually) until a dedicated dashboard
  configuration UI lands.

These keys live alongside the widget's other settings in its `config.json`.
Do not instruct users to overwrite `config.json` directly, and do not expose
its other contents when discussing this feature.

## Safety model

- All native dialogs/launches run fixed AppleScript source via
  `/usr/bin/osascript`; the script text itself never changes at runtime.
- The monitor command is the only value passed into AppleScript; it is passed
  as a separate argv item after `--`, never interpolated into the AppleScript
  or a shell string. The work description is not passed into AppleScript at
  all — it is captured by the fixed prompt dialog and returned on stdout, then
  used only to build the deep link or clipboard payload. It is never
  interpolated into AppleScript source.
- No Accessibility automation, no simulated keystrokes, and no auto-send —
  the operator always performs the final submit action.
- No network calls occur during tests.
- The TV Fleet Dashboard only opens URLs that pass an `http(s)` scheme
  allowlist check; anything else is rejected.

## Offline verification

Run these without launching the full app or GUI:

```
/opt/homebrew/bin/node --check main.js
/opt/homebrew/bin/node --test test/*.test.js
/usr/bin/osascript -e 'display dialog "What are we working on?" default answer "" with title "Relay Station"'
/bin/test -f "<relaystationMain repo>/scripts/agent_watch.py"
```

The `osascript` command reproduces the fixed prompt dialog in isolation;
cancel it to confirm no launch occurs on cancel.

## Local build/deploy (unsigned, arm64)

```
/opt/homebrew/bin/npm install --no-package-lock
CSC_IDENTITY_AUTO_DISCOVERY=false /opt/homebrew/bin/npx electron-builder --mac dir --arm64
```

This produces an unsigned, non-notarized `arm64` build under `dist/` for
local testing only — no `sudo`, no code signing, no release notarization.

Deployment first backs up the currently installed
`/Applications/Claude-Usage-Widget.app`, then installs the new build. If
launch or smoke testing fails, the backup is restored in place of the new
build. The backup is deleted only after the new build is verified to work.

## Known limitation

Claude Desktop has no supported deep-link contract in this implementation, so
prompt handoff to it is clipboard-based and requires manual paste/send — this
is a platform constraint, not an oversight.

## Token efficiency

The generated coordinator prompt explicitly asks for narrow cards and bounded
turns to limit token usage. The Terminal Control Board shows per-task/per-run
token activity and cache reuse for observability — it is not a billing or
provider-quota view.

## Fleet transport (F-2)

The widget also carries the fleet layer's transport leg (`AGENT_OBSERVABILITY_FLEET.md`
in `relaystation_main`, phase F-2): an independent poll of `agent_watch.py`'s
F-1 safe-snapshot outbox and a best-effort push to the fleet aggregator. This
is wholly separate from the RSM-4 usage push above — its own setting, its own
credential, its own timer, its own module (`src/push-fleet-snapshot.js`), and
its own IPC channels. It never touches the RSM-4 push or its call site.

### Configuration

- `settings.fleetUrl` — the fleet aggregator ingest URL, a non-secret
  `electron-store` setting mirroring `settings.rsm4Url`. Empty ⇒ the feature
  is OFF and the poll timer does no work beyond checking this value.
- The `fleet_ingest` bearer credential is set via the `set-fleet-token` IPC
  handler (mirroring `set-rsm4-token`) and stored through Electron
  `safeStorage` (OS-keychain backed) **exactly like** the RSM-4 collector
  token, with one deliberate difference: it is **fail-closed**. If
  `safeStorage` is unavailable, `set-fleet-token` refuses to store anything
  (no plaintext fallback, unlike RSM-4's legacy plain-storage path) and the
  poll timer skips every tick — no push at all — until `safeStorage` is
  available and a credential has been provisioned. `has-fleet-token` reports
  whether a credential is currently stored.

### Outbox path

Resolved identically to `agent_watch.state_dir()`:

```
base = $AGENT_WATCH_STATE_DIR
       || $XDG_STATE_HOME/relay-agent-watch
       || ~/.local/state/relay-agent-watch
outbox = <base>/fleet_snapshot.json
```

A missing or corrupt outbox file simply means "nothing to push" — never an
error, never a thrown exception.

### Poll / heartbeat cadence

A single timer, independent of the usage-refresh timer, ticks roughly every
**5 seconds**. Each tick reads the outbox, computes a sha256 content hash of
its canonical (key-sorted) JSON, and pushes the full snapshot only when that
hash differs from the last **successfully** pushed hash (material-change
detection). Independently, a full-snapshot **heartbeat** push fires roughly
every **30 seconds** even when the content is unchanged, for liveness. A
failed push is **dropped** — there is no queue or retry buffer — so the next
tick simply re-evaluates and re-sends the current full snapshot.

### `emitter_epoch` / `seq` ownership

The widget — never the F-1 outbox — mints the transport identity: an opaque
`emitter_epoch` (a fresh UUID) once per process start, and a monotonic `seq`
counter within it. Both reset on every widget restart. Each push stamps these
onto the snapshot's machine-heartbeat block before sending.

### Known gaps

- **Windows test leg unrun.** The offline `node --test` suite
  (`test/push-fleet-snapshot.test.js`) was written to be OS-agnostic
  (`path.join`, `os.homedir()`, no shell/sleep assumptions) and was run and
  verified green only on macOS in this session. It has **not** been run on
  Windows; that leg must still be run on the operator's Windows machine before
  this is considered fully verified there.
- **Deployability.** This code lands on the widget's `main` branch; it takes
  effect only after an **operator rebuild/release** (`RELEASE_PROCESS.md`),
  never an autonomous deploy — there is no running service to restart.

## Fleet setup (the widget as the single control surface)

The Settings panel's **Fleet** section is the one place on a machine to
configure everything `agent_watch.py` (in the separate `relaystation_main`
repo) needs to join the fleet. It manages:

- **Fleet collision key** — a shared secret used to correlate a machine's
  submissions across the fleet. **Generate** mints a fresh 32-byte key
  (`crypto.randomBytes(32).toString('hex')`, 64 hex chars) and shows it once
  in the field for the operator to copy — it is not re-displayed after
  saving. To join an *existing* fleet, paste a key generated on another
  machine instead. Leaving the field blank on save keeps whatever key is
  already stored.
- **Collision key ID** — a plain-text label for the key (e.g. a team or
  fleet name), non-secret.
- **Machine ID** — read-only. `agent_watch.py` mints and persists this on
  first active use; the widget only displays it and never generates or
  overwrites it.
- **Fleet aggregator URL** / **Fleet ingest token** — the same
  `settings.fleetUrl` / `set-fleet-token` pair documented under "Fleet
  transport (F-2)" above; this panel is now their home in the UI.

Saving the panel writes `fleet_collision_key` and `collision_key_id` to
`fleet_config.json`, sitting next to the F-1/F-2 outbox at the same
`agent_watch.state_dir()` path (see "Outbox path" above) — `src/fleet-config.js`
resolves it via the same `resolveOutboxPath` base. The write is atomic
(temp file + rename, mode `0600`) and always **preserves an existing
`machine_id`** — the widget never mints or drops it, since doing so would
make `agent_watch` treat the machine as a new identity. A blank collision
key on save likewise never wipes a previously stored key. Reads
(`get-fleet-config`) never return the raw key, only whether one is set.

This is a widget-side follow-up to the fleet layer; the corresponding
`relaystation_main` fleet doc (`AGENT_OBSERVABILITY_FLEET.md` §4) still needs
its own update to point operators at this panel — that is a **separate,
later card**, not part of this change.
