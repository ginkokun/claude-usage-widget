# Staged Changes

Changes accumulating here are waiting to be included in the next release.
This file is tracked in the repo and updated as branches are merged into `develop`.

---

## Branches Staged

| Branch | Description |
|--------|-------------|
| `fix/linux-tray-icon-cleanup` | Centralized tray destroy to prevent stale Linux appindicator icons (PR #48) |
| `fix/linux-autostart-toggle` | Disable Launch at startup toggle on Linux with explanatory hint (PR #49) |

---

## Changes

### fix/linux-tray-icon-cleanup (PR #48 — sergkuzn)

**Centralized tray icon cleanup**
Introduced `destroyTrayIcons()` helper that both `updateTrayIcon()` and `createTray()` now call instead of inline destroy logic. On Linux, clears the tray image before calling `destroy()` to give the appindicator host an explicit repaint signal — without this, stale tray icons linger after the app disables tray stats or quits.

**Guard against partial tray state**
`createTray()` now checks whether only one of the two stat icons survived (e.g. after a crash or partial cleanup). If so, it tears down the survivor before rebuilding both from scratch, preventing mismatched icon pairs.

**Skip tray creation at startup when disabled**
`app.whenReady()` no longer calls `createTray()` unconditionally. The call is skipped if `showTrayStats` is false, avoiding temporary ghost icons during startup.

---

### fix/linux-autostart-toggle (PR #49 — sergkuzn)

**Disable "Launch at startup" on Linux**
Electron's `openAtLogin` / `setLoginItemSettings()` is silently ignored on Linux. The toggle is now disabled in the UI on Linux, with a "Not supported on Linux" hint displayed beneath it. The column gets a greyed-out style via `.settings-col-disabled`.

**Force autoStart = false on Linux in settings save**
Both the IPC `save-settings` handler and the renderer's `saveSettings()` function now coerce `autoStart` to `false` on Linux before persisting or sending the value, preventing the stored setting from being out of sync with reality.

---

*Add new entries above this line as additional branches are staged.*
