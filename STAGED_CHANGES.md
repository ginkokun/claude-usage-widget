# Staged Changes

Changes accumulating here have already been merged into `develop`.
We keep track of these changes/fixes/features and when we have enough for a new version we decide on the next version release.

This file is tracked in the repo and visible to everyone.

---

## Branches Staged

| Branch | Description |
|--------|-------------|
| `fix/linux-tray-icon-cleanup` | Centralized tray destroy to prevent stale Linux appindicator icons (PR #48) |
| `fix/linux-autostart-toggle` | Disable Launch at startup toggle on Linux with explanatory hint (PR #49) |
| `fix/weekly-tray-click-duplicate` | Tray icon restore fixes |
| `fix/minimize-disappears-from-taskbar` | Minimize/restore regression on Windows (v1.7.2) |

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

### fix/minimize-disappears-from-taskbar

Reported by users on Windows 10 and Windows 11: clicking the minimize button
caused the app to disappear from both the taskbar and the system tray, making
it completely inaccessible. Introduced in v1.7.2, not present in v1.7.1.
Three interdependent bugs combined to produce the symptom.

**Bug 1 — Tray icons destroyed after every data poll**
`updateTrayIcon()` destroyed both `sessionTray` and `weeklyTray` whenever
`showTrayStats` was `false` (the default setting). This ran on every data poll,
so within seconds of startup both tray icons were silently gone. The
`minimize-window` handler relies on the tray icon as the restore path when the
window is hidden, so with no tray icon the app became completely inaccessible.
Fix: only destroy `weeklyTray` when stats are disabled. `sessionTray` is kept
alive as a static icon and always serves as the restore path.

**Bug 2 — Minimize always called `hide()` on Windows regardless of settings**
The `minimize-window` IPC handler always called `mainWindow.hide()` on
Windows, which removes the window from the taskbar entirely. This was designed
to work alongside a persistent tray icon (as in v1.7.1), but Bug 1 had already
destroyed the tray. The "Hide from Taskbar" (`minimizeToTray`) setting existed
but was never consulted.
Fix: check `minimizeToTray` before deciding. When off (the default), call
`mainWindow.minimize()` so the window stays in the taskbar like a normal
Windows application. When on, call `hide()` as before — the tray icon (kept
alive by Bug 1's fix) provides the restore path.

**Bug 3 — `showMainWindowClean()` left the window unfocused and unresponsive**
After restoring the window via the tray icon, UI elements (e.g. the settings
cog) were unresponsive to clicks. `showMainWindowClean()` used an opacity trick
(`setOpacity(0)` → `show()` → 50 ms → `setOpacity(1)`) to suppress a DWM
blink artifact, but never called `focus()`. Without focus, Windows does not
route mouse events to the window. Additionally, the `setOpacity` sequence left
the window in a layered state that further interfered with input routing.
Fix: removed the opacity trick and replaced it with `show()` + `focus()`
directly, matching the behaviour of v1.7.1. This supersedes the
`showMainWindowClean()` change introduced in `fix/weekly-tray-click-duplicate`
— the DWM double-blink that change targeted is acceptable compared to an
unresponsive window.

---

*Add new entries above this line as additional branches are staged.*
