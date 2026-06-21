// Optional RSM-4 push (fork-only feature).
//
// After the widget fetches and parses Claude usage for the selected org, it can
// also POST that usage to an RSM-4 Resource Service ingest endpoint. The whole
// feature is OFF when the ingest URL is empty — in that case nothing here runs
// and the widget behaves exactly like upstream.
//
// This module is intentionally isolated and side-effect-free apart from the
// single outbound POST. It never throws to the caller: any failure is logged
// and swallowed so the widget's normal operation and UI are never affected.

/**
 * Map a Claude usage window ({utilization, resets_at}) to an RSM-4 window object.
 * Returns null when the source data is missing or the utilization is not a
 * finite number — callers must skip null windows (never send NaN/undefined).
 *
 * @param {string} windowId - RSM-4 window id (e.g. "5h", "weekly").
 * @param {{utilization?: number, resets_at?: string}|undefined} src
 * @returns {{window_id: string, used_pct: number, resets_at?: string}|null}
 */
function buildWindow(windowId, src) {
  if (!src) return null;
  const pct = Number(src.utilization);
  if (!Number.isFinite(pct)) return null;
  const win = { window_id: windowId, used_pct: pct };
  if (src.resets_at) win.resets_at = src.resets_at;
  return win;
}

/**
 * Build the RSM-4 ingest payload from a parsed Claude usage object.
 * Only includes windows that have valid data. weekly_opus / weekly_sonnet are
 * included only when the org's usage object carries seven_day_opus /
 * seven_day_sonnet.
 *
 * @param {object} usageData - The same parsed usage object the UI displays.
 * @param {string} platform - process.platform, used for the source label.
 * @returns {object} payload ready to JSON.stringify.
 */
function buildPayload(usageData, platform) {
  const windows = [
    buildWindow('5h', usageData.five_hour),
    buildWindow('weekly', usageData.seven_day),
    buildWindow('weekly_opus', usageData.seven_day_opus),
    buildWindow('weekly_sonnet', usageData.seven_day_sonnet),
  ].filter(Boolean);

  return {
    source: `widget-${platform}`,
    nodes: [
      {
        node_id: 'claude',
        windows,
        fetched_at: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Fire-and-forget push of parsed usage to the RSM-4 ingest endpoint.
 *
 * No-op (returns false) when the URL is empty/missing — that is the OFF state.
 * Never throws: on any error it logs via the provided logger and returns false.
 *
 * @param {object} usageData - Parsed usage object for the selected org.
 * @param {object} opts
 * @param {string} opts.url - RSM-4 ingest URL. Empty => feature off.
 * @param {string} opts.token - Bearer collector token (may be empty).
 * @param {string} opts.platform - process.platform.
 * @param {(...args: any[]) => void} [opts.log] - logger (defaults to console.error).
 * @returns {Promise<boolean>} true if a POST was attempted and got a 2xx response.
 */
async function pushUsageToRSM4(usageData, { url, token, platform, log } = {}) {
  const logError = typeof log === 'function' ? log : console.error;

  // Feature is OFF when the URL is empty — behave exactly like upstream.
  if (!url || typeof url !== 'string' || !url.trim()) return false;
  if (!usageData) return false;

  try {
    const payload = buildPayload(usageData, platform || process.platform);

    // Skip the network call entirely if there is nothing valid to send.
    if (!payload.nodes[0].windows.length) {
      logError('[RSM-4] No valid usage windows to push; skipping.');
      return false;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Electron's main process provides a global fetch (Node 18+ / Electron 28).
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res || !res.ok) {
      const status = res ? res.status : 'no-response';
      logError(`[RSM-4] Push failed: HTTP ${status}`);
      return false;
    }
    return true;
  } catch (err) {
    logError('[RSM-4] Push error:', err && err.message ? err.message : err);
    return false;
  }
}

module.exports = { pushUsageToRSM4, buildPayload, buildWindow };
