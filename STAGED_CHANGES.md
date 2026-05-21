# Staged Changes

Changes accumulating here have already been merged into `develop`.
We keep track of these changes/fixes/features and when we have enough for a new release we decide on the next version number.

This file is tracked in the repo and visible to everyone.

---

## Branches Staged

| Branch | Description |
|--------|-------------|
| `feature/compact-settings-fullscreen` | Open full settings panel from compact mode instead of limited overlay |
| `feature/chart-time-scale` | Proportional time-scale X-axis for usage graph |
| `fix/account-history-isolation` | Per-account history isolation, invalid session write guard, stale data pruning |
| `design/settings-column-reorder` | Settings panel right-column reorder |
| `fix/chart-axis-bounds` | Clamp chart X-axis to actual data range; stable daily tick labels |
| `feature/extended-usage-fields` | Display Cowork, OAuth Apps, Sonnet, Opus rows and chart lines; fix resets_at blank |

---

## Changes

### feature/compact-settings-fullscreen

**Full settings from compact mode**
In compact mode, clicking the settings icon now temporarily expands the window to full size and opens the complete settings panel — the same panel available in normal mode. Previously, compact mode only showed a minimal overlay with a single compact mode toggle.

After clicking **Done**, all settings are saved and the window returns to compact mode. If the user disables compact mode inside settings, the window stays at normal size.

---

### feature/chart-time-scale

**Proportional time-scale X-axis for usage graph**
The graph X-axis now positions data points according to their actual timestamps rather than evenly spaced categorical slots. This fixes two issues reported in discussion #61:

- Time gaps (e.g. closing the app overnight) now appear as proportional gaps in the graph line rather than being compressed
- Rapid manual refreshes no longer stretch the chart — closely spaced points cluster correctly without distorting the scale

---

### fix/account-history-isolation

**Per-account history isolation (issue #63)**
Usage history is now stored under a namespaced key per organization ID (`usageHistory_<orgId>`). Switching accounts shows only that account's data in the graph. Switching back to a previous account restores its history. Existing single-account history is automatically migrated to the new key format on first launch — no data is lost.

**Invalid session write guard (issue #63)**
The app now skips writing to the graph if the API response is missing reset timestamps. A valid authenticated session always includes these; their absence reliably indicates a dead session (removed device, expired token, etc.). Zero values from invalid sessions will no longer pollute the graph.

**Stale history pruning**
A startup pruner scans all per-account history keys and removes entries older than 8 days. If a key becomes empty (all entries expired), the key itself is deleted. This automatically cleans up data from accounts that are no longer in use. Retention window also reduced from 30 days to 8 days to align with the 7-day chart display.

---

### design/settings-column-reorder

**Settings panel right-column reorder**
The right column of the settings panel now reads top to bottom: Hide from Taskbar, Show tray stats, Usage Alerts, Organization (when visible). Previously Show tray stats was separated from the other toggles and the org selector had its own standalone row at the bottom. The org selector now shares the Theme row, removing a redundant row from the layout.

---

### fix/chart-axis-bounds

**Stable chart X-axis with correct date range**
The usage graph X-axis now clamps exactly to the data range — no more future dates appearing when Chart.js auto-extended the axis beyond the last data point. Daily tick labels are generated using calendar day arithmetic (`setDate(d + 1)`) rather than fixed millisecond steps, so labels stay stable across auto-refreshes regardless of when data was collected.

---

### feature/extended-usage-fields

**Extended API usage fields: Cowork, OAuth Apps, Sonnet, Opus**
The widget now displays rows and graph lines for additional API fields returned by some account types:

- **Cowork (7d)** — shown in cyan. Handles accounts that return this data under the internal `seven_day_omelette` field name by normalizing it to `seven_day_cowork` before rendering.
- **OAuth Apps (7d)** — shown in orange.
- **Sonnet (7d)** — shown in rose/pink. Fixes a pre-existing color conflict where this row used the same blue as the Weekly bar.
- **Opus (7d)** — shown in amber.

All four rows and chart lines only appear when the API returns non-null data for that field, so users on plans without model-level breakdowns see no change.

**Fix: Resets At blank for all extra rows**
The reset date text (e.g. "Resets May 27") was never being populated for any extra row — the span was created but left empty. All extra rows now correctly display their reset date using the same `formatResetsAt` logic as the main session and weekly rows.

---

*Add new entries above this line as additional branches are staged.*
