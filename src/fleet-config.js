// Fleet config (widget-side writer): the tray widget is the SINGLE control
// surface for a machine's fleet setup. It writes `fleet_config.json` next to
// the F-2 outbox (`fleet_snapshot.json`) in the same agent_watch state dir;
// agent_watch.py (separate repo) reads it to learn fleet_collision_key and
// collision_key_id, and mints+persists machine_id on first active use.
//
// This module is a PURE Node module — no Electron import, unit-testable under
// `node --test` with no live network or real home writes (AGENT_WATCH_STATE_DIR
// env override).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { resolveOutboxPath } = require('./push-fleet-snapshot');

const CONFIG_FILENAME = 'fleet_config.json';

/**
 * Resolve the fleet_config.json path — the same state dir as the F-1/F-2
 * outbox (`resolveOutboxPath`), just a different filename.
 *
 * @param {{env?: NodeJS.ProcessEnv, homedir?: () => string}} [opts]
 * @returns {string}
 */
function configPath({ env = process.env, homedir = os.homedir } = {}) {
  return path.join(path.dirname(resolveOutboxPath({ env, homedir })), CONFIG_FILENAME);
}

/**
 * Fail-safe read of the raw stored config. Missing/corrupt file -> null.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function readRawConfig(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read the fleet config for display in the widget. NEVER returns the raw
 * collision_key — only whether one is set.
 *
 * @param {{env?: NodeJS.ProcessEnv, homedir?: () => string}} [opts]
 * @returns {{collision_key_id: string, machine_id: string|null, hasKey: boolean}}
 */
function readConfig(opts = {}) {
  const raw = readRawConfig(configPath(opts));
  if (!raw) {
    return { collision_key_id: '', machine_id: null, hasKey: false };
  }
  return {
    collision_key_id: typeof raw.collision_key_id === 'string' ? raw.collision_key_id : '',
    machine_id: typeof raw.machine_id === 'string' ? raw.machine_id : null,
    hasKey: typeof raw.fleet_collision_key === 'string' && raw.fleet_collision_key.length > 0,
  };
}

/**
 * Write the fleet config that agent_watch.py reads. Merges onto the existing
 * file so that:
 *   - an existing machine_id is always preserved (agent_watch mints it; the
 *     widget must never drop or overwrite it), and
 *   - a blank collision_key on write keeps the existing stored key rather
 *     than wiping it.
 *
 * Atomic write (temp file + rename) at mode 0600 since this file holds a
 * secret (fleet_collision_key).
 *
 * @param {{collision_key?: string, collision_key_id?: string}} update
 * @param {{env?: NodeJS.ProcessEnv, homedir?: () => string}} [opts]
 * @returns {{collision_key_id: string, machine_id: string|null, hasKey: boolean}}
 */
function writeConfig(update, opts = {}) {
  const filePath = configPath(opts);
  const existing = readRawConfig(filePath) || {};

  const next = {
    ...existing,
    collision_key_id:
      update.collision_key_id !== undefined ? update.collision_key_id : existing.collision_key_id || '',
    fleet_collision_key:
      update.collision_key && update.collision_key.trim()
        ? update.collision_key.trim()
        : existing.fleet_collision_key || '',
  };
  // Preserve machine_id verbatim if present — never minted or dropped here.
  if (existing.machine_id !== undefined) {
    next.machine_id = existing.machine_id;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);

  return readConfig(opts);
}

/**
 * Generate a new fleet collision key: 32 random bytes as hex (64 chars).
 * Returned once for the operator to copy to other machines — never persisted
 * by this function alone (the caller must pass it to writeConfig).
 *
 * @returns {string}
 */
function generateCollisionKey() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  configPath,
  readConfig,
  writeConfig,
  generateCollisionKey,
};
