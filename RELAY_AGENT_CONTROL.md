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
